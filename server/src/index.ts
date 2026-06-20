import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import transactionsRouter from './routes/transactions';
import budgetRouter from './routes/budget';
import plansRouter from './routes/plans';
import savingsRouter from './routes/savings';
import plaidRouter from './routes/plaid';
import dashboardRouter from './routes/dashboard';

// ── Startup sanity checks ───────────────────────────────────
for (const key of ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_PASSWORD', 'ENCRYPTION_KEY']) {
  if (!process.env[key]) {
    console.error(`FATAL: missing required env var ${key}`);
    process.exit(1);
  }
}
if ((process.env.ADMIN_PASSWORD ?? '').length < 12) {
  console.warn(
    'WARNING: ADMIN_PASSWORD is shorter than 12 characters. This protects your bank data — use a long passphrase.'
  );
}

const app = express();

// Render/Vercel sit behind a proxy; needed for correct per-IP rate limiting
app.set('trust proxy', 1);

// CSP tuned so Plaid Link (loaded from cdn.plaid.com) and the SPA both work.
// Plaid renders its flow inside an iframe served from cdn.plaid.com; Radix/Tailwind
// rely on inline styles. The API and app share an origin, so 'self' covers them.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'https://cdn.plaid.com'],
        'frame-src': ["'self'", 'https://cdn.plaid.com'],
        'connect-src': ["'self'", 'https://production.plaid.com', 'https://cdn.plaid.com'],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'https://*.plaid.com'],
      },
    },
  })
);
app.use(compression());
app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }));

// Capture raw body so the Plaid webhook signature can be verified
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    },
  })
);

// Global rate limit (generous), plus a strict one on login inside auth router
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/plans', plansRouter);
app.use('/api/savings', savingsRouter);
app.use('/api/plaid', plaidRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Any unmatched /api route → JSON 404 (so the SPA fallback below never swallows it)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Serve the built client (single-origin homelab deploy) ────
// In production the Express server also serves client/dist, so the frontend and
// API share an origin — no CORS, and a single hostname for Cloudflare Tunnel.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  console.warn(`Client build not found at ${clientDist} — run "npm run build --workspace=client".`);
}

const PORT = parseInt(process.env.PORT ?? '3001', 10);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
