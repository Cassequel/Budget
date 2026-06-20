import { Router, Response } from 'express';
import { db } from '../db';
import { transactions } from '../db/schema';
import { eq, desc, gte, lte, and, SQL } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { categorizeUncategorized } from '../categorize';

const router = Router();
router.use(requireAuth);

// Manually trigger auto-categorization of any uncategorized transactions.
router.post('/categorize', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await categorizeUncategorized();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Categorization failed' });
  }
});

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { from, to, account, category } = req.query as Record<string, string>;
    const conditions: SQL[] = [];
    if (from) conditions.push(gte(transactions.date, from));
    if (to) conditions.push(lte(transactions.date, to));
    if (account) conditions.push(eq(transactions.accountId, account));
    if (category) conditions.push(eq(transactions.category, category));

    const rows = await db
      .select()
      .from(transactions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(transactions.date))
      .limit(500);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { category, notes } = req.body as { category?: string; notes?: string };
    const updated = await db
      .update(transactions)
      .set({ category, notes, updatedAt: new Date() })
      .where(eq(transactions.id, id))
      .returning();
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

export default router;
