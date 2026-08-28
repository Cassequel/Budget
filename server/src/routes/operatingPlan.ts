import { Router, Response } from 'express';
import { db } from '../db';
import { operatingPlan, accounts, creditCards, savingsGoals, planItems, transactions } from '../db/schema';
import { and, gte, gt, eq, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { utilizationRatio, nextMilestone, round2 } from '../utilization';

const router = Router();
router.use(requireAuth);

const DAYS_PER_MONTH = 30.44;
const BILLS_HORIZON_DAYS = 21;

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function daysUntil(dateStr: string): number {
  const today = parseYmd(ymd(new Date()));
  return Math.round((parseYmd(dateStr).getTime() - today.getTime()) / 86_400_000);
}
// Credit-card due/close dates recur monthly. Roll a stored date forward whole
// months until it's today or later, so an old value still means "the next one".
function rollForwardMonthly(dateStr: string): string {
  const today = parseYmd(ymd(new Date()));
  const d = parseYmd(dateStr);
  while (d.getTime() < today.getTime()) d.setMonth(d.getMonth() + 1);
  return ymd(d);
}
function n(v: string | null | undefined): number | null {
  return v == null ? null : parseFloat(v);
}
// Display formatter for the human-readable action strings.
function usd(v: number | null | undefined): string {
  return v == null
    ? '$0'
    : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

async function getOrCreatePlan() {
  const rows = await db.select().from(operatingPlan).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db.insert(operatingPlan).values({}).returning();
  return inserted[0];
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    res.json(await getOrCreatePlan());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load operating plan' });
  }
});

router.put('/', async (req: AuthRequest, res: Response) => {
  try {
    const plan = await getOrCreatePlan();
    const b = req.body as Record<string, unknown>;
    const patch: Partial<typeof operatingPlan.$inferInsert> = { updatedAt: new Date() };
    if ('monthlySurvivalCost' in b) patch.monthlySurvivalCost = money(b.monthlySurvivalCost);
    if ('cashReserveTarget' in b) patch.cashReserveTarget = money(b.cashReserveTarget);
    if ('incomeType' in b && ['variable', 'fixed', 'mixed'].includes(String(b.incomeType))) {
      patch.incomeType = String(b.incomeType);
    }
    if ('incomeNotes' in b) patch.incomeNotes = (b.incomeNotes as string) ?? null;
    const updated = await db.update(operatingPlan).set(patch).where(eq(operatingPlan.id, plan.id)).returning();
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update operating plan' });
  }
});

// The computed home-screen picture: cash, coverage, utilization, what's due,
// goal pace, and up to three concrete next actions.
router.get('/status', async (_req: AuthRequest, res: Response) => {
  try {
    const plan = await getOrCreatePlan();
    const [accts, cards, goals, items] = await Promise.all([
      db.select().from(accounts),
      db.select().from(creditCards),
      db.select().from(savingsGoals).orderBy(savingsGoals.priority, savingsGoals.targetDate),
      db.select().from(planItems),
    ]);

    // ── Cash ────────────────────────────────────────────────
    const depository = accts.filter((a) => a.type === 'depository');
    const cashOf = (role: string) =>
      round2(
        depository
          .filter((a) => a.cashRole === role)
          .reduce((s, a) => s + (n(a.availableBalance) ?? n(a.currentBalance) ?? 0), 0)
      );
    const cashAvailable = cashOf('spending');
    const cashReserve = cashOf('reserve');
    const survivalCost = n(plan.monthlySurvivalCost);
    const reserveTarget = n(plan.cashReserveTarget);
    const monthsCoverage = survivalCost && survivalCost > 0 ? round2(cashAvailable / survivalCost) : null;
    const reserveGap = reserveTarget != null ? round2(Math.max(0, reserveTarget - cashReserve)) : null;

    const balancesUpdatedAt = accts.length
      ? new Date(Math.max(...accts.map((a) => a.updatedAt.getTime()))).toISOString()
      : null;

    // ── Average real monthly spend (last 3 months) ──────────
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const spendRes = await db
      .select({ total: sql<string>`sum(amount)` })
      .from(transactions)
      .where(
        and(
          gte(transactions.date, ymd(threeMonthsAgo)),
          gt(transactions.amount, '0'),
          eq(transactions.flowType, 'spending')
        )
      );
    const avgMonthlySpend = round2(parseFloat(spendRes[0]?.total ?? '0') / 3);

    // ── Utilization (per card + combined) ──────────────────
    const liveById = new Map(accts.map((a) => [a.id, n(a.currentBalance)]));
    const perCard = cards.map((c) => {
      const live = c.accountId ? liveById.get(c.accountId) ?? null : null;
      const balance = round2(n(c.statementBalance) ?? live ?? 0);
      const limit = n(c.creditLimit);
      const ratio = utilizationRatio({ balance, limit });
      const due = c.dueDate ? rollForwardMonthly(c.dueDate) : null;
      const close = c.statementCloseDate ? rollForwardMonthly(c.statementCloseDate) : null;
      return {
        id: c.id,
        name: c.name,
        balance,
        limit,
        ratio,
        minimumPayment: n(c.minimumPayment),
        dueDate: due,
        statementCloseDate: close,
        autopayMinimum: c.autopayMinimum,
        apr: n(c.apr),
        promoAprExpiry: c.promoAprExpiry,
        nextMilestone: nextMilestone(balance, limit, ratio),
      };
    });
    const withLimit = perCard.filter((c) => c.limit != null && c.limit > 0);
    const combBalance = round2(withLimit.reduce((s, c) => s + c.balance, 0));
    const combLimit = round2(withLimit.reduce((s, c) => s + (c.limit ?? 0), 0));
    const combRatio = combLimit > 0 ? combBalance / combLimit : null;
    const combinedNextMilestone = nextMilestone(combBalance, combLimit, combRatio);

    // ── Bills / minimums due next (≤ 21 days) ──────────────
    type Bill = {
      kind: 'card_minimum' | 'plan_item';
      name: string;
      amount: number | null;
      dueDate: string;
      daysUntil: number;
      autopayMinimum?: boolean;
    };
    const bills: Bill[] = [];
    for (const c of perCard) {
      if (!c.dueDate) continue;
      const du = daysUntil(c.dueDate);
      if (du <= BILLS_HORIZON_DAYS) {
        bills.push({
          kind: 'card_minimum',
          name: c.name,
          amount: c.minimumPayment,
          dueDate: c.dueDate,
          daysUntil: du,
          autopayMinimum: c.autopayMinimum,
        });
      }
    }
    for (const it of items) {
      if (it.isPaid || !it.dueDate) continue;
      const du = daysUntil(it.dueDate);
      if (du >= 0 && du <= BILLS_HORIZON_DAYS) {
        bills.push({ kind: 'plan_item', name: it.name, amount: n(it.amount), dueDate: it.dueDate, daysUntil: du });
      }
    }
    bills.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // ── Goals with required pace ───────────────────────────
    const goalStatus = goals.map((g) => {
      const target = n(g.targetAmount) ?? 0;
      const current = n(g.currentAmount) ?? 0;
      const remaining = round2(Math.max(0, target - current));
      let monthsLeft: number | null = null;
      let requiredMonthlyPace: number | null = null;
      if (g.targetDate) {
        monthsLeft = round2(Math.max(0.1, (parseYmd(g.targetDate).getTime() - Date.now()) / 86_400_000 / DAYS_PER_MONTH));
        requiredMonthlyPace = round2(remaining / monthsLeft);
      }
      return {
        id: g.id,
        name: g.name,
        why: g.why,
        priority: g.priority,
        fundingSource: g.fundingSource,
        targetAmount: target,
        currentAmount: current,
        remaining,
        targetDate: g.targetDate,
        monthsLeft,
        requiredMonthlyPace,
        done: remaining === 0,
      };
    });

    // ── Up to three next actions, in priority order ────────
    const actions: { title: string; detail: string; kind: string }[] = [];
    // 1. Utilization (the stated #1 priority)
    if (combRatio != null && combinedNextMilestone) {
      actions.push({
        kind: 'utilization',
        title: `Pay ${usd(combinedNextMilestone.paymentToReach)} toward cards to reach ${combinedNextMilestone.threshold}% utilization`,
        detail: `Overall utilization is ${(combRatio * 100).toFixed(1)}% (${usd(combBalance)} of ${usd(combLimit)}).`,
      });
    }
    // 2. A bill/minimum due within a week that isn't on confirmed autopay
    const urgent = bills.find(
      (b) => b.daysUntil <= 7 && !(b.kind === 'card_minimum' && b.autopayMinimum)
    );
    if (urgent) {
      actions.push({
        kind: 'bill',
        title:
          urgent.kind === 'card_minimum'
            ? `Confirm autopay or pay ${usd(urgent.amount)} to ${urgent.name}`
            : `Pay ${usd(urgent.amount)} for ${urgent.name}`,
        detail: `Due ${urgent.dueDate} (${urgent.daysUntil === 0 ? 'today' : `in ${urgent.daysUntil} day${urgent.daysUntil === 1 ? '' : 's'}`}).`,
      });
    }
    // 3. Thin cash coverage
    if (monthsCoverage != null && monthsCoverage < 1) {
      actions.push({
        kind: 'coverage',
        title: `Build cash — under one month of your ${usd(survivalCost)} baseline is covered`,
        detail: `${usd(cashAvailable)} available ≈ ${monthsCoverage.toFixed(1)} months.`,
      });
    }
    // 4. A dated goal that's behind a reasonable pace
    const behindGoal = goalStatus.find(
      (g) => !g.done && g.requiredMonthlyPace != null && g.requiredMonthlyPace > 0
    );
    if (behindGoal && actions.length < 3) {
      actions.push({
        kind: 'goal',
        title: `Set aside ${usd(behindGoal.requiredMonthlyPace)}/mo for "${behindGoal.name}"`,
        detail: `${usd(behindGoal.remaining)} to go by ${behindGoal.targetDate} (${behindGoal.monthsLeft} months).`,
      });
    }
    // 5. Reserve gap
    if (reserveGap != null && reserveGap > 0 && actions.length < 3) {
      actions.push({
        kind: 'reserve',
        title: `Grow your cash reserve by ${usd(reserveGap)}`,
        detail: `Reserve is ${usd(cashReserve)} of a ${usd(reserveTarget)} target.`,
      });
    }

    const planComplete = survivalCost != null && withLimit.length > 0;

    res.json({
      planComplete,
      balancesUpdatedAt,
      cash: {
        available: cashAvailable,
        reserve: cashReserve,
        reserveTarget,
        reserveGap,
        monthsCoverage,
        monthlySurvivalCost: survivalCost,
        avgMonthlySpend,
      },
      utilization: {
        combined: { balance: combBalance, limit: combLimit, ratio: combRatio, nextMilestone: combinedNextMilestone },
        perCard,
      },
      billsDueNext: bills,
      goals: goalStatus,
      actions: actions.slice(0, 3),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute status' });
  }
});

// Round a currency-ish input to a 2dp string for storage, or null when blank.
function money(v: unknown): string | null {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? round2(x).toString() : null;
}

export default router;
