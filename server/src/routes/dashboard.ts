import { Router, Response } from 'express';
import { db } from '../db';
import { accounts, transactions, plans, planItems, savingsGoals } from '../db/schema';
import { gte, lte, and, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-31`;

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
      .where(and(gte(transactions.date, monthStart), lte(transactions.date, monthEnd)));

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
      .where(and(gte(transactions.date, from3m), gte(transactions.amount, '0')));

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

export default router;
