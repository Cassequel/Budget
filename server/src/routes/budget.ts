import { Router, Response } from 'express';
import { db } from '../db';
import { budgetCategories, transactions } from '../db/schema';
import { eq, gte, lte, and, sql } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/categories', async (_req: AuthRequest, res: Response) => {
  const rows = await db.select().from(budgetCategories).orderBy(budgetCategories.name);
  res.json(rows);
});

router.post('/categories', async (req: AuthRequest, res: Response) => {
  const { name, monthlyLimit, color, icon, type } = req.body as {
    name: string; monthlyLimit?: number; color?: string; icon?: string; type?: string;
  };
  const inserted = await db.insert(budgetCategories).values({ name, monthlyLimit: monthlyLimit?.toString(), color, icon, type: type ?? 'expense' }).returning();
  res.status(201).json(inserted[0]);
});

router.patch('/categories/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, monthlyLimit, color, icon } = req.body as { name?: string; monthlyLimit?: number; color?: string; icon?: string };
  const updated = await db.update(budgetCategories).set({ name, monthlyLimit: monthlyLimit?.toString(), color, icon }).where(eq(budgetCategories.id, id)).returning();
  res.json(updated[0]);
});

router.delete('/categories/:id', async (req: AuthRequest, res: Response) => {
  await db.delete(budgetCategories).where(eq(budgetCategories.id, req.params.id as string));
  res.status(204).send();
});

router.get('/summary', async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = (req.query.from as string) ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  // Last day of the current month — `new Date(y, m+1, 0)` rolls back to it, so we
  // never emit an invalid literal like "2026-06-31".
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const to = (req.query.to as string) ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(lastDay)}`;

  const cats = await db.select().from(budgetCategories);
  const spending = await db
    .select({ category: transactions.category, total: sql<string>`sum(amount)` })
    .from(transactions)
    .where(and(gte(transactions.date, from), lte(transactions.date, to)))
    .groupBy(transactions.category);

  const spendMap = Object.fromEntries(spending.map((r) => [r.category ?? 'Uncategorized', parseFloat(r.total ?? '0')]));

  const summary = cats.map((c) => ({
    ...c,
    spent: spendMap[c.name] ?? 0,
    limit: parseFloat(c.monthlyLimit ?? '0'),
  }));

  res.json({ from, to, categories: summary });
});

export default router;
