import { Router, Response } from 'express';
import { db } from '../db';
import { savingsGoals, accounts, transactions } from '../db/schema';
import { eq, gte, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/goals', async (_req: AuthRequest, res: Response) => {
  const rows = await db.select().from(savingsGoals).orderBy(savingsGoals.targetDate);
  res.json(rows);
});

router.post('/goals', async (req: AuthRequest, res: Response) => {
  const { name, targetAmount, currentAmount, targetDate, linkedAccountId } = req.body as {
    name: string; targetAmount: number; currentAmount?: number; targetDate?: string; linkedAccountId?: string;
  };
  const inserted = await db
    .insert(savingsGoals)
    .values({ name, targetAmount: targetAmount.toString(), currentAmount: currentAmount?.toString(), targetDate, linkedAccountId })
    .returning();
  res.status(201).json(inserted[0]);
});

router.patch('/goals/:id', async (req: AuthRequest, res: Response) => {
  const { name, targetAmount, currentAmount, targetDate } = req.body as {
    name?: string; targetAmount?: number; currentAmount?: number; targetDate?: string;
  };
  const updated = await db
    .update(savingsGoals)
    .set({ name, targetAmount: targetAmount?.toString(), currentAmount: currentAmount?.toString(), targetDate })
    .where(eq(savingsGoals.id, req.params.id as string))
    .returning();
  res.json(updated[0]);
});

router.get('/runway', async (_req: AuthRequest, res: Response) => {
  const accts = await db.select().from(accounts);
  const liquidTypes = ['depository'];
  const totalLiquid = accts
    .filter((a) => liquidTypes.includes(a.type))
    .reduce((sum, a) => sum + parseFloat(a.availableBalance ?? a.currentBalance ?? '0'), 0);

  // avg monthly spend over last 3 months
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const from = threeMonthsAgo.toISOString().split('T')[0];

  const result = await db
    .select({ total: sql<string>`sum(amount)` })
    .from(transactions)
    .where(gte(transactions.date, from));

  const totalSpend = parseFloat(result[0]?.total ?? '0');
  const avgMonthlySpend = totalSpend / 3;
  const runwayMonths = avgMonthlySpend > 0 ? totalLiquid / avgMonthlySpend : null;

  res.json({ totalLiquid, avgMonthlySpend, runwayMonths });
});

export default router;
