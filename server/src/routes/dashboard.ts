import { Router, Response } from 'express';
import { db } from '../db';
import { accounts, transactions, plans, planItems, savingsGoals } from '../db/schema';
import { gte, lt, gt, and, or, isNull, notInArray, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { NON_SPENDING_CATEGORIES } from '../db/seedCategories';

const router = Router();
router.use(requireAuth);

// Format a Date as YYYY-MM-DD (local fields, no timezone shift).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Matches transactions that should count toward spend/income aggregates:
// everything except the non-spending categories. NULL (uncategorized) still
// counts, so we OR it in explicitly (SQL `NOT IN` would drop NULLs).
const isSpending = or(
  isNull(transactions.category),
  notInArray(transactions.category, NON_SPENDING_CATEGORIES)
);

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    // Use a half-open range [monthStart, nextMonthStart) so we never build an
    // invalid literal like "2026-06-31" (which Postgres rejects with 22008).
    const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    const nextMonthStart = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1));

    const [accts, planList, goals] = await Promise.all([
      db.select().from(accounts),
      db.select().from(plans),
      db.select().from(savingsGoals),
    ]);

    const totalNetWorth = accts.reduce((sum, a) => {
      const bal = parseFloat(a.currentBalance ?? '0');
      return sum + (a.type === 'credit' ? -bal : bal);
    }, 0);

    const monthlyResult = await db
      .select({
        income: sql<string>`sum(case when amount < 0 then abs(amount) else 0 end)`,
        spend: sql<string>`sum(case when amount > 0 then amount else 0 end)`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, monthStart), lt(transactions.date, nextMonthStart), isSpending));

    const monthlyIncome = parseFloat(monthlyResult[0]?.income ?? '0');
    const monthlySpend = parseFloat(monthlyResult[0]?.spend ?? '0');

    // Upcoming plan totals (unpaid items in the next 6 months)
    const upcomingItems = await db.select().from(planItems);
    const planTotals = planList.map((p) => {
      const items = upcomingItems.filter((i) => i.planId === p.id);
      return {
        ...p,
        totalAmount: items.reduce((s, i) => s + parseFloat(i.amount), 0),
        paidAmount: items.filter((i) => i.isPaid).reduce((s, i) => s + parseFloat(i.amount), 0),
        itemCount: items.length,
      };
    });

    // Runway
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const from3m = threeMonthsAgo.toISOString().split('T')[0];
    const spendResult = await db
      .select({ total: sql<string>`sum(amount)` })
      .from(transactions)
      .where(and(gte(transactions.date, from3m), gt(transactions.amount, '0'), isSpending));

    const avgMonthlySpend = parseFloat(spendResult[0]?.total ?? '0') / 3;
    const totalLiquid = accts
      .filter((a) => a.type === 'depository')
      .reduce((s, a) => s + parseFloat(a.availableBalance ?? a.currentBalance ?? '0'), 0);
    const runwayMonths = avgMonthlySpend > 0 ? totalLiquid / avgMonthlySpend : null;

    res.json({
      totalNetWorth,
      monthlyIncome,
      monthlySpend,
      runwayMonths,
      plans: planTotals,
      savingsGoals: goals,
      accountCount: accts.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dashboard fetch failed' });
  }
});

// Monthly spending grouped by category, for the dashboard trend line and the
// breakdown page. Only counts money out (amount > 0). Returns one row per
// (month, category); the client pivots it for both the line and bar charts.
router.get('/spending-trend', async (req: AuthRequest, res: Response) => {
  try {
    const months = Math.min(Math.max(parseInt((req.query.months as string) ?? '12', 10) || 12, 1), 36);
    const now = new Date();
    // First day of the earliest month in the window.
    const from = ymd(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));

    const monthExpr = sql<string>`to_char(${transactions.date}, 'YYYY-MM')`;
    const rows = await db
      .select({
        month: monthExpr,
        category: transactions.category,
        total: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(and(gte(transactions.date, from), gt(transactions.amount, '0'), isSpending))
      .groupBy(monthExpr, transactions.category);

    res.json(
      rows.map((r) => ({
        month: r.month,
        category: r.category ?? 'Uncategorized',
        total: parseFloat(r.total ?? '0'),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load spending trend' });
  }
});

export default router;
