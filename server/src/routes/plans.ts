import { Router, Response } from 'express';
import { db } from '../db';
import { plans, planItems } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req: AuthRequest, res: Response) => {
  const rows = await db.select().from(plans).orderBy(plans.targetDate);
  res.json(rows);
});

router.post('/', async (req: AuthRequest, res: Response) => {
  const { name, type, targetDate, notes } = req.body as { name: string; type: string; targetDate?: string; notes?: string };
  const inserted = await db.insert(plans).values({ name, type, targetDate, notes }).returning();
  res.status(201).json(inserted[0]);
});

router.patch('/:id', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, type, targetDate, notes } = req.body as { name?: string; type?: string; targetDate?: string; notes?: string };
  const updated = await db.update(plans).set({ name, type, targetDate, notes }).where(eq(plans.id, id)).returning();
  res.json(updated[0]);
});

router.get('/:id/items', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const rows = await db.select().from(planItems).where(eq(planItems.planId, id)).orderBy(planItems.dueDate);
  res.json(rows);
});

router.post('/:id/items', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { name, amount, dueDate, notes } = req.body as { name: string; amount: number; dueDate?: string; notes?: string };
  const inserted = await db.insert(planItems).values({ planId: id, name, amount: amount.toString(), dueDate, notes }).returning();
  res.status(201).json(inserted[0]);
});

router.patch('/:id/items/:itemId', async (req: AuthRequest, res: Response) => {
  const itemId = req.params.itemId as string;
  const { name, amount, dueDate, isPaid, notes } = req.body as { name?: string; amount?: number; dueDate?: string; isPaid?: boolean; notes?: string };
  const updated = await db
    .update(planItems)
    .set({ name, amount: amount?.toString(), dueDate, isPaid, notes })
    .where(eq(planItems.id, itemId))
    .returning();
  res.json(updated[0]);
});

router.delete('/:id/items/:itemId', async (req: AuthRequest, res: Response) => {
  const itemId = req.params.itemId as string;
  await db.delete(planItems).where(eq(planItems.id, itemId));
  res.status(204).send();
});

export default router;
