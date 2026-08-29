import { Router, Response } from 'express';
import { db } from '../db';
import { creditCards, accounts, operatingPlan } from '../db/schema';
import { eq, and, inArray, notInArray } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { utilizationRatio, nextMilestone, round2 } from '../utilization';
import { daysUntil, rollForwardMonthly } from '../dates';
import { Strategy, milestoneLadder, allocatePayment, applyPayments } from '../payoff';

const router = Router();
router.use(requireAuth);

// The balance a card's utilization is measured on: the entered statement
// balance if we have one, otherwise the live Plaid balance on the linked
// account, otherwise 0.
function cardBalance(card: typeof creditCards.$inferSelect, liveBalance: number | null): number {
  if (card.statementBalance != null) return parseFloat(card.statementBalance);
  if (liveBalance != null) return liveBalance;
  return 0;
}

async function decorate(cards: (typeof creditCards.$inferSelect)[]) {
  const acctIds = cards.map((c) => c.accountId).filter((id): id is string => id != null);
  const accts = acctIds.length
    ? await db.select().from(accounts).where(inArray(accounts.id, acctIds))
    : [];
  const liveById = new Map(
    accts.map((a) => [a.id, a.currentBalance != null ? parseFloat(a.currentBalance) : null])
  );

  return cards.map((c) => {
    const live = c.accountId ? liveById.get(c.accountId) ?? null : null;
    const balance = cardBalance(c, live);
    const limit = c.creditLimit != null ? parseFloat(c.creditLimit) : null;
    const ratio = utilizationRatio({ balance, limit });
    return {
      ...c,
      liveBalance: live,
      utilizationBalance: round2(balance),
      utilizationRatio: ratio,
      nextMilestone: nextMilestone(balance, limit, ratio),
    };
  });
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(creditCards).orderBy(creditCards.name);
    res.json(await decorate(rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch credit cards' });
  }
});

// Create a card row for every linked `credit` account that doesn't have one
// yet, pre-filling the name and a best-guess limit (live balance + available
// credit, when Plaid reported it). Idempotent.
router.post('/sync-from-accounts', async (_req: AuthRequest, res: Response) => {
  try {
    const linked = await db.select({ accountId: creditCards.accountId }).from(creditCards);
    const have = linked.map((l) => l.accountId).filter((id): id is string => id != null);
    const creditAccts = await db
      .select()
      .from(accounts)
      .where(have.length ? and(eq(accounts.type, 'credit'), notInArray(accounts.id, have)) : eq(accounts.type, 'credit'));

    if (!creditAccts.length) {
      res.json({ created: 0, cards: await decorate(await db.select().from(creditCards).orderBy(creditCards.name)) });
      return;
    }

    const toInsert = creditAccts.map((a) => {
      const cur = a.currentBalance != null ? parseFloat(a.currentBalance) : null;
      const avail = a.availableBalance != null ? parseFloat(a.availableBalance) : null;
      const guessLimit = cur != null && avail != null ? round2(cur + avail) : null;
      return {
        accountId: a.id,
        name: [a.institutionName, a.name].filter(Boolean).join(' ') || a.name,
        creditLimit: guessLimit != null ? guessLimit.toString() : null,
      };
    });
    await db.insert(creditCards).values(toInsert);
    const rows = await db.select().from(creditCards).orderBy(creditCards.name);
    res.status(201).json({ created: toInsert.length, cards: await decorate(rows) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync cards from accounts' });
  }
});

// Per-card + combined payoff ladders, next due/close dates, autopay + promo-APR
// flags — everything the credit-control page needs to lay out "pay $X to reach
// Y%" and the date reminders.
router.get('/payoff', async (_req: AuthRequest, res: Response) => {
  try {
    const { cards } = await loadCardsWithBalances();
    const decorated = cards.map((c) => {
      const due = c.dueDate ? rollForwardMonthly(c.dueDate) : null;
      const close = c.statementCloseDate ? rollForwardMonthly(c.statementCloseDate) : null;
      return {
        id: c.id,
        name: c.name,
        balance: round2(c.balance),
        limit: c.limit,
        apr: c.apr,
        ratio: utilizationRatio({ balance: c.balance, limit: c.limit }),
        minimumPayment: toNum(c.minimumPayment),
        autopayMinimum: c.autopayMinimum,
        dueDate: due,
        daysUntilDue: due ? daysUntil(due) : null,
        statementCloseDate: close,
        daysUntilClose: close ? daysUntil(close) : null,
        // Paying before the statement closes is what lowers the utilization the
        // bureaus actually see this cycle.
        payBeforeClose: !!(close && c.balance > 0 && (!due || daysUntil(close) <= daysUntil(due))),
        promoAprExpiry: c.promoAprExpiry,
        daysUntilPromoEnd: c.promoAprExpiry ? daysUntil(c.promoAprExpiry) : null,
        ladder: milestoneLadder(c.balance, c.limit),
      };
    });

    const withLimit = cards.filter((c) => c.limit != null && c.limit > 0);
    const combBalance = round2(withLimit.reduce((s, c) => s + c.balance, 0));
    const combLimit = round2(withLimit.reduce((s, c) => s + (c.limit ?? 0), 0));

    res.json({
      cards: decorated,
      combined: {
        balance: combBalance,
        limit: combLimit,
        ratio: combLimit > 0 ? combBalance / combLimit : null,
        ladder: milestoneLadder(combBalance, combLimit || null),
      },
      cash: await cashSnapshot(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute payoff' });
  }
});

// "What if I pay $X today?" — body is either { amount, strategy } to split a
// lump sum, or { payments: [{ cardId, amount }] } for exact per-card amounts.
// Returns the before/after utilization picture and what it does to your cash.
router.post('/simulate', async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body as Record<string, unknown>;
    const { cards } = await loadCardsWithBalances();

    let applied: Record<string, number> = {};
    let unused = 0;
    let amount = 0;

    if (Array.isArray(b.payments)) {
      for (const p of b.payments as { cardId?: string; amount?: unknown }[]) {
        const v = toNum(p.amount == null ? null : String(p.amount));
        if (p.cardId && v != null && v > 0) applied[p.cardId] = round2((applied[p.cardId] ?? 0) + v);
      }
      amount = round2(Object.values(applied).reduce((s, v) => s + v, 0));
    } else {
      amount = Math.max(0, toNum(b.amount == null ? null : String(b.amount)) ?? 0);
      const strategy: Strategy = (['avalanche', 'highest-util', 'proportional'] as const).includes(
        b.strategy as Strategy
      )
        ? (b.strategy as Strategy)
        : 'highest-util';
      const alloc = allocatePayment(cards, amount, strategy);
      applied = alloc.applied;
      unused = alloc.unused;
    }

    const result = applyPayments(cards, applied);
    const cash = await cashSnapshot();
    const spentFromCash = round2(amount - unused);
    const availableAfter = round2(cash.available - spentFromCash);
    const monthsCoverageAfter =
      cash.survivalCost && cash.survivalCost > 0 ? round2(availableAfter / cash.survivalCost) : null;

    let warning: string | null = null;
    if (availableAfter < 0) {
      warning = `That's ${usd(-availableAfter)} more than your spendable cash (${usd(cash.available)}).`;
    } else if (monthsCoverageAfter != null && monthsCoverageAfter < 1) {
      warning = `Leaves ${usd(availableAfter)} — under one month of your ${usd(cash.survivalCost)} baseline.`;
    } else if (
      cash.reserveTarget != null &&
      cash.reserve < cash.reserveTarget &&
      availableAfter < cash.reserveTarget - cash.reserve
    ) {
      warning = `Leaves ${usd(availableAfter)} — not enough to also close your ${usd(
        cash.reserveTarget - cash.reserve
      )} cash-reserve gap.`;
    }

    res.json({
      amount,
      unused,
      perCard: result.perCard,
      combined: result.combined,
      cash: {
        availableBefore: cash.available,
        spentFromCash,
        availableAfter,
        monthsCoverageAfter,
        survivalCost: cash.survivalCost,
        dropsBelowReserve: availableAfter < 0,
        warning,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to simulate payment' });
  }
});

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.name || typeof b.name !== 'string') {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const inserted = await db
      .insert(creditCards)
      .values({
        name: b.name,
        accountId: (b.accountId as string) ?? null,
        creditLimit: num(b.creditLimit),
        statementBalance: num(b.statementBalance),
        minimumPayment: num(b.minimumPayment),
        dueDate: (b.dueDate as string) ?? null,
        statementCloseDate: (b.statementCloseDate as string) ?? null,
        apr: num(b.apr),
        promoAprExpiry: (b.promoAprExpiry as string) ?? null,
        autopayMinimum: Boolean(b.autopayMinimum),
        notes: (b.notes as string) ?? null,
      })
      .returning();
    res.status(201).json((await decorate(inserted))[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create credit card' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const b = req.body as Record<string, unknown>;
    const patch: Partial<typeof creditCards.$inferInsert> = { updatedAt: new Date() };
    if ('name' in b) patch.name = String(b.name);
    if ('accountId' in b) patch.accountId = (b.accountId as string) || null;
    if ('creditLimit' in b) patch.creditLimit = num(b.creditLimit);
    if ('statementBalance' in b) patch.statementBalance = num(b.statementBalance);
    if ('minimumPayment' in b) patch.minimumPayment = num(b.minimumPayment);
    if ('dueDate' in b) patch.dueDate = (b.dueDate as string) || null;
    if ('statementCloseDate' in b) patch.statementCloseDate = (b.statementCloseDate as string) || null;
    if ('apr' in b) patch.apr = num(b.apr);
    if ('promoAprExpiry' in b) patch.promoAprExpiry = (b.promoAprExpiry as string) || null;
    if ('autopayMinimum' in b) patch.autopayMinimum = Boolean(b.autopayMinimum);
    if ('notes' in b) patch.notes = (b.notes as string) ?? null;

    const updated = await db.update(creditCards).set(patch).where(eq(creditCards.id, id)).returning();
    if (!updated.length) {
      res.status(404).json({ error: 'Credit card not found' });
      return;
    }
    res.json((await decorate(updated))[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update credit card' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await db.delete(creditCards).where(eq(creditCards.id, req.params.id as string));
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete credit card' });
  }
});

// Coerce a possibly-missing/empty numeric body field to a stored string or null.
function num(v: unknown): string | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n.toString() : null;
}

// Parse a stored numeric string to a number, or null when absent/blank.
function toNum(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

// Compact whole-dollar formatter for the human-readable warning strings.
function usd(v: number | null | undefined): string {
  return v == null
    ? '$0'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

type LoadedCard = Omit<typeof creditCards.$inferSelect, 'apr'> & {
  balance: number;
  limit: number | null;
  apr: number | null;
};

// Every card row with its utilization balance (statement balance, else the
// linked account's live balance, else 0) and numeric limit/APR resolved.
async function loadCardsWithBalances(): Promise<{ cards: LoadedCard[] }> {
  const rows = await db.select().from(creditCards).orderBy(creditCards.name);
  const acctIds = rows.map((c) => c.accountId).filter((id): id is string => id != null);
  const accts = acctIds.length
    ? await db.select().from(accounts).where(inArray(accounts.id, acctIds))
    : [];
  const liveById = new Map(
    accts.map((a) => [a.id, a.currentBalance != null ? parseFloat(a.currentBalance) : null])
  );
  const cards = rows.map((c) => {
    const live = c.accountId ? liveById.get(c.accountId) ?? null : null;
    return {
      ...c,
      balance: round2(cardBalance(c, live)),
      limit: toNum(c.creditLimit),
      apr: toNum(c.apr),
    };
  });
  return { cards };
}

// Spendable / reserve cash and the operating-plan targets, for the cash-safety
// check on a simulated payment.
async function cashSnapshot() {
  const [accts, planRows] = await Promise.all([
    db.select().from(accounts),
    db.select().from(operatingPlan).limit(1),
  ]);
  const plan = planRows[0];
  const dep = accts.filter((a) => a.type === 'depository');
  const sumRole = (role: string) =>
    round2(
      dep
        .filter((a) => a.cashRole === role)
        .reduce((s, a) => s + (toNum(a.availableBalance) ?? toNum(a.currentBalance) ?? 0), 0)
    );
  return {
    available: sumRole('spending'),
    reserve: sumRole('reserve'),
    reserveTarget: toNum(plan?.cashReserveTarget ?? null),
    survivalCost: toNum(plan?.monthlySurvivalCost ?? null),
  };
}

export default router;
