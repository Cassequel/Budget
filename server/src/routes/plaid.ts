import { Router, Request, Response } from 'express';
import { plaidClient } from '../plaid/client';
import { syncAllItems, exchangeAndStore } from '../plaid/sync';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { CountryCode, Products } from 'plaid';

const router = Router();

router.post('/link-token', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'admin' },
      client_name: 'Budget App',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

router.post('/exchange', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { public_token, institution } = req.body as {
      public_token: string;
      institution?: { institution_id?: string; name?: string };
    };
    const item = await exchangeAndStore(public_token, institution?.institution_id, institution?.name);
    res.json({ itemId: item.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

router.post('/sync', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const result = await syncAllItems();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

router.post('/webhook', async (req: Request, res: Response) => {
  const { webhook_type, webhook_code } = req.body as { webhook_type: string; webhook_code: string };
  if (webhook_type === 'TRANSACTIONS' && webhook_code === 'SYNC_UPDATES_AVAILABLE') {
    syncAllItems().catch(console.error);
  }
  res.json({ ok: true });
});

export default router;
