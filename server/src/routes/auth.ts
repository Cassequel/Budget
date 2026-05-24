import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  const token = jwt.sign({ sub: 'admin' }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  } as jwt.SignOptions);
  res.json({ token });
});

router.get('/me', requireAuth, (_req: AuthRequest, res: Response) => {
  res.json({ user: 'admin' });
});

export default router;
