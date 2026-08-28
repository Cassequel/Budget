import { Router, Response } from 'express';
import { db } from '../db';
import { accounts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db.select().from(accounts).orderBy(accounts.institutionName);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

const CASH_ROLES = ['spending', 'reserve', 'excluded'] as const;

// Set how an account's cash counts toward the operating plan.
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { cashRole } = req.body as { cashRole?: string };
    if (!cashRole || !CASH_ROLES.includes(cashRole as (typeof CASH_ROLES)[number])) {
      res.status(400).json({ error: `cashRole must be one of ${CASH_ROLES.join(', ')}` });
      return;
    }
    const updated = await db
      .update(accounts)
      .set({ cashRole, updatedAt: new Date() })
      .where(eq(accounts.id, req.params.id as string))
      .returning();
    if (!updated.length) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(updated[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update account' });
  }
});

export default router;
