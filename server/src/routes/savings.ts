import { Router, Response } from 'express';
import { db } from '../db';
import { savingsGoals, accounts, transactions } from '../db/schema';
import { eq, gte, gt, and, inArray, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// Same deterministic filter dashboard.ts uses — see server/src/flowType.ts.
const isSpending = eq(transactions.flowType, 'spending');

router.get('/goals', async (_req: AuthRequest, res: Response) => {
  const rows = await db.select().from(savingsGoals).orderBy(savingsGoals.priority, savingsGoals.targetDate);
  const linkedIds = rows.map((r) => r.linkedAccountId).filter((id): id is string => id != null);
  const linkedAccounts = linkedIds.length
    ? await db
        .select({ id: accounts.id, currentBalance: accounts.currentBalance })
        .from(accounts)
        .where(inArray(accounts.id, linkedIds))
    : [];
  const balanceById = new Map(linkedAccounts.map((a) => [a.id, a.currentBalance]));

  // A goal linked to an account tracks that account's real balance — the
  // manually-entered currentAmount is only used when there's no link.
  res.json(
    rows.map((r) =>
      r.linkedAccountId && balanceById.has(r.linkedAccountId)
        ? { ...r, currentAmount: balanceById.get(r.linkedAccountId) }
        : r
    )
  );
});

router.post('/goals', async (req: AuthRequest, res: Response) => {
  const { name, targetAmount, currentAmount, targetDate, linkedAccountId, priority, fundingSource, why } =
    req.body as {
      name: string; targetAmount: number; currentAmount?: number; targetDate?: string;
      linkedAccountId?: string; priority?: number; fundingSource?: string; why?: string;
    };
  const inserted = await db
    .insert(savingsGoals)
    .values({
      name,
      targetAmount: targetAmount.toString(),
      currentAmount: currentAmount?.toString(),
      targetDate,
      linkedAccountId,
      priority: Number.isFinite(priority) ? Math.trunc(priority as number) : undefined,
      fundingSource: fundingSource ?? undefined,
      why: why ?? undefined,
    })
    .returning();
  res.status(201).json(inserted[0]);
});

router.patch('/goals/:id', async (req: AuthRequest, res: Response) => {
  const { name, targetAmount, currentAmount, targetDate, linkedAccountId, priority, fundingSource, why } =
    req.body as {
      name?: string; targetAmount?: number; currentAmount?: number; targetDate?: string;
      linkedAccountId?: string | null; priority?: number; fundingSource?: string | null; why?: string | null;
    };
  const [existing] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, req.params.id as string));
  if (!existing) {
    res.status(404).json({ error: 'Goal not found' });
    return;
  }
  // currentAmount is derived from the linked account's balance, not editable directly.
  const linkedNow = linkedAccountId === undefined ? existing.linkedAccountId : linkedAccountId;
  const nextCurrentAmount = linkedNow ? undefined : currentAmount?.toString();
  const updated = await db
    .update(savingsGoals)
    .set({
      name,
      targetAmount: targetAmount?.toString(),
      currentAmount: nextCurrentAmount,
      targetDate,
      linkedAccountId: linkedAccountId === undefined ? undefined : linkedAccountId,
      priority: Number.isFinite(priority) ? Math.trunc(priority as number) : undefined,
      fundingSource: fundingSource === undefined ? undefined : fundingSource,
      why: why === undefined ? undefined : why,
    })
    .where(eq(savingsGoals.id, req.params.id as string))
    .returning();
  res.json(updated[0]);
});

router.delete('/goals/:id', async (req: AuthRequest, res: Response) => {
  await db.delete(savingsGoals).where(eq(savingsGoals.id, req.params.id as string));
  res.status(204).send();
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
    .where(and(gte(transactions.date, from), gt(transactions.amount, '0'), isSpending));

  const totalSpend = parseFloat(result[0]?.total ?? '0');
  const avgMonthlySpend = totalSpend / 3;
  const runwayMonths = avgMonthlySpend > 0 ? totalLiquid / avgMonthlySpend : null;

  res.json({ totalLiquid, avgMonthlySpend, runwayMonths });
});

export default router;
