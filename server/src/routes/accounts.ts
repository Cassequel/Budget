import { Router, Response } from 'express';
import { db } from '../db';
import { accounts } from '../db/schema';
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

export default router;
