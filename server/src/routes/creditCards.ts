import { Router, Response } from 'express';
import { db } from '../db';
import { creditCards, accounts } from '../db/schema';
import { eq, and, inArray, notInArray } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { utilizationRatio, nextMilestone, round2 } from '../utilization';

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

export default router;
