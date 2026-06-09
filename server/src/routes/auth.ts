import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// Constant-time comparison (hashing first normalizes length)
function safeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Strict limit on login attempts: 10 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

router.post('/login', loginLimiter, (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== 'string' || !safeCompare(password, process.env.ADMIN_PASSWORD!)) {
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
