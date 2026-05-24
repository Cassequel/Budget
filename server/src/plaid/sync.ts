import { plaidClient } from './client';
import { db } from '../db';
import { plaidItems, accounts, transactions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { decrypt } from '../lib/crypto';

export async function syncAllItems(): Promise<{ synced: number; errors: number }> {
  const items = await db.select().from(plaidItems);
  let synced = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await syncItem(item.id, decrypt(item.accessTokenEncrypted), item.cursor);
      synced++;
    } catch (err) {
      console.error(`Sync failed for item ${item.id}:`, err);
      errors++;
    }
  }

  return { synced, errors };
}

async function syncItem(itemId: string, accessToken: string, cursor: string | null) {
  let currentCursor = cursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
    });

    const { added, modified, removed, next_cursor, has_more } = response.data;

    for (const tx of added) {
      const acct = await resolveAccount(tx.account_id);
      await db
        .insert(transactions)
        .values({
          plaidTransactionId: tx.transaction_id,
          accountId: acct.id,
          amount: tx.amount.toString(),
          date: tx.date,
          name: tx.name,
          merchantName: tx.merchant_name ?? null,
          category: acct.category,
          plaidCategory: tx.personal_finance_category?.primary ?? null,
          isPending: tx.pending,
        })
        .onConflictDoNothing();
    }

    for (const tx of modified) {
      await db
        .update(transactions)
        .set({ amount: tx.amount.toString(), name: tx.name, isPending: tx.pending, updatedAt: new Date() })
        .where(eq(transactions.plaidTransactionId, tx.transaction_id));
    }

    for (const tx of removed) {
      await db.delete(transactions).where(eq(transactions.plaidTransactionId, tx.transaction_id));
    }

    currentCursor = next_cursor;
    hasMore = has_more;
  }

  await db.update(plaidItems).set({ cursor: currentCursor, updatedAt: new Date() }).where(eq(plaidItems.id, itemId));
}

async function resolveAccount(plaidAccountId: string): Promise<{ id: string | null; category: string | null }> {
  const acct = await db
    .select({ id: accounts.id, institutionName: accounts.institutionName, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.plaidAccountId, plaidAccountId));
  if (!acct[0]) return { id: null, category: null };
  const { id, institutionName, name } = acct[0];
  const category = [institutionName, name].filter(Boolean).join(' - ');
  return { id, category: category || null };
}

export async function exchangeAndStore(publicToken: string, institutionId: string | undefined, institutionName: string | undefined) {
  const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = exchangeRes.data;

  const { encrypt } = await import('../lib/crypto');
  const encryptedToken = encrypt(access_token);

  const [item] = await db
    .insert(plaidItems)
    .values({ itemId: item_id, accessTokenEncrypted: encryptedToken, institutionId, institutionName })
    .returning();

  // Pull and store accounts immediately
  const acctRes = await plaidClient.accountsGet({ access_token });
  for (const acct of acctRes.data.accounts) {
    await db
      .insert(accounts)
      .values({
        plaidItemId: item.id,
        plaidAccountId: acct.account_id,
        name: acct.name,
        officialName: acct.official_name ?? null,
        type: acct.type,
        subtype: acct.subtype ?? null,
        mask: acct.mask ?? null,
        currentBalance: acct.balances.current?.toString() ?? null,
        availableBalance: acct.balances.available?.toString() ?? null,
        currencyCode: acct.balances.iso_currency_code ?? 'USD',
        institutionName: institutionName ?? null,
      })
      .onConflictDoNothing();
  }

  return item;
}
