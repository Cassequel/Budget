import { db } from './index';
import { transactions } from './schema';
import { deriveFlowType, type FlowType } from '../flowType';
import { inArray } from 'drizzle-orm';

/**
 * One-off backfill: recompute flow_type for every existing transaction from
 * its stored plaid_category/plaid_category_detailed. Safe to re-run — it's
 * fully deterministic and just overwrites flow_type each time.
 */
export async function backfillFlowType(): Promise<number> {
  const rows = await db
    .select({
      id: transactions.id,
      plaidCategory: transactions.plaidCategory,
      plaidCategoryDetailed: transactions.plaidCategoryDetailed,
    })
    .from(transactions);

  const byFlowType = new Map<FlowType, string[]>();
  for (const row of rows) {
    const flowType = deriveFlowType(row.plaidCategory, row.plaidCategoryDetailed);
    const list = byFlowType.get(flowType) ?? [];
    list.push(row.id);
    byFlowType.set(flowType, list);
  }

  for (const [flowType, ids] of byFlowType) {
    if (!ids.length) continue;
    await db.update(transactions).set({ flowType }).where(inArray(transactions.id, ids));
  }

  return rows.length;
}

// Allow running directly: `ts-node src/db/backfillFlowType.ts`
if (require.main === module) {
  import('dotenv').then(({ config }) => {
    config({ path: require('path').resolve(__dirname, '../../../.env') });
    backfillFlowType()
      .then((n) => {
        console.log(`Backfilled flow_type for ${n} transactions.`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
}
