import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import transactionsRouter from './routes/transactions';
import budgetRouter from './routes/budget';
import plansRouter from './routes/plans';
import savingsRouter from './routes/savings';
import plaidRouter from './routes/plaid';
import dashboardRouter from './routes/dashboard';

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/plans', plansRouter);
app.use('/api/savings', savingsRouter);
app.use('/api/plaid', plaidRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = parseInt(process.env.PORT ?? '3001', 10);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
