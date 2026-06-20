import { Router, Request, Response } from 'express';
import { plaidClient } from '../plaid/client';
import { syncAllItems, exchangeAndStore } from '../plaid/sync';
import { verifyPlaidWebhook } from '../plaid/webhookVerify';
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
      // Register the webhook so Plaid pushes new transactions to us (live updates)
      ...(process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {}),
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
    if (!public_token || typeof public_token !== 'string') {
      res.status(400).json({ error: 'public_token is required' });
      return;
    }
    const item = await exchangeAndStore(public_token, institution?.institution_id, institution?.name);
    // Kick off a background sync so transactions appear immediately after linking
    syncAllItems().catch((err) => console.error('Post-exchange sync failed:', err));
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
  // Verify the request actually came from Plaid before doing anything
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  const verified = await verifyPlaidWebhook(req.headers['plaid-verification'] as string | undefined, rawBody).catch(
    () => false
  );
  if (!verified) {
    res.status(401).json({ error: 'Webhook verification failed' });
    return;
  }

  const { webhook_type, webhook_code } = req.body as { webhook_type: string; webhook_code: string };
  if (webhook_type === 'TRANSACTIONS' && webhook_code === 'SYNC_UPDATES_AVAILABLE') {
    syncAllItems().catch(console.error);
  }
  res.json({ ok: true });
});

export default router;
