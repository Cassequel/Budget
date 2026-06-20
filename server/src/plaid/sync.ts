import { plaidClient } from './client';
import { db } from '../db';
import { plaidItems, accounts, transactions } from '../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { decrypt, encrypt } from '../lib/crypto';
import { categorizeUncategorized } from '../categorize';

// Prevent overlapping syncs (e.g. webhook firing while a manual sync runs)
type SyncResult = { synced: number; errors: number; categorized: number };
let inFlight: Promise<SyncResult> | null = null;

export function syncAllItems(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSyncAllItems().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSyncAllItems(): Promise<SyncResult> {
  const items = await db.select().from(plaidItems);

  // One account lookup for the whole sync instead of one query per transaction
  const acctRows = await db
    .select({ id: accounts.id, plaidAccountId: accounts.plaidAccountId })
    .from(accounts);
  const acctMap = new Map(acctRows.map((a) => [a.plaidAccountId, a.id]));

  let synced = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await syncItem(item.id, decrypt(item.accessTokenEncrypted), item.cursor, acctMap);
      synced++;
    } catch (err) {
      console.error(`Sync failed for item ${item.id}:`, err);
      errors++;
    }
  }

  // Auto-categorize anything new this sync pulled in. A failure here must not
  // fail the sync itself — categories can always be backfilled on a later run.
  let categorized = 0;
  try {
    ({ categorized } = await categorizeUncategorized());
  } catch (err) {
    console.error('Auto-categorization failed:', err);
  }

  return { synced, errors, categorized };
}

const CHUNK = 200;

async function syncItem(
  itemId: string,
  accessToken: string,
  cursor: string | null,
  acctMap: Map<string, string | null>
) {
  let currentCursor = cursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await plaidClient.transactionsSync({
      access_token: accessToken,
      cursor: currentCursor,
    });

    const { added, modified, removed, next_cursor, has_more } = response.data;

    // Batch-insert added transactions instead of one INSERT per row
    if (added.length) {
      const rows = added.map((tx) => ({
        plaidTransactionId: tx.transaction_id,
        accountId: acctMap.get(tx.account_id) ?? null,
        amount: tx.amount.toString(),
        date: tx.date,
        name: tx.name,
        merchantName: tx.merchant_name ?? null,
        // Leave category NULL so the auto-categorizer (and only it) fills it in.
        category: null,
        plaidCategory: tx.personal_finance_category?.primary ?? null,
        plaidCategoryDetailed: tx.personal_finance_category?.detailed ?? null,
        isPending: tx.pending,
      }));
      for (let i = 0; i < rows.length; i += CHUNK) {
        await db.insert(transactions).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
      }
    }

    // Modified rows carry different values each — run updates concurrently
    if (modified.length) {
      await Promise.all(
        modified.map((tx) =>
          db
            .update(transactions)
            .set({ amount: tx.amount.toString(), name: tx.name, isPending: tx.pending, updatedAt: new Date() })
            .where(eq(transactions.plaidTransactionId, tx.transaction_id))
        )
      );
    }

    // Removed rows can be deleted in a single statement
    if (removed.length) {
      await db.delete(transactions).where(
        inArray(
          transactions.plaidTransactionId,
          removed.map((tx) => tx.transaction_id)
        )
      );
    }

    currentCursor = next_cursor;
    hasMore = has_more;
  }

  await db.update(plaidItems).set({ cursor: currentCursor, updatedAt: new Date() }).where(eq(plaidItems.id, itemId));
}

export async function exchangeAndStore(publicToken: string, institutionId: string | undefined, institutionName: string | undefined) {
  const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = exchangeRes.data;

  const encryptedToken = encrypt(access_token);

  const [item] = await db
    .insert(plaidItems)
    .values({ itemId: item_id, accessTokenEncrypted: encryptedToken, institutionId, institutionName })
    .returning();

  // Pull and store accounts immediately (single batched insert)
  const acctRes = await plaidClient.accountsGet({ access_token });
  const acctRows = acctRes.data.accounts.map((acct) => ({
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
  }));
  if (acctRows.length) {
    await db.insert(accounts).values(acctRows).onConflictDoNothing();
  }

  return item;
}
