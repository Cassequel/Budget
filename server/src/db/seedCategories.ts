import { db } from './index';
import { budgetCategories } from './schema';

/**
 * Canonical budget categories. The `name` values are the source of truth that
 * everything else lines up against: transactions.category stores one of these
 * names, the budget summary joins spending by name, and the auto-categorizer
 * (server/src/categorize.ts) constrains both its deterministic Plaid map and
 * the Haiku model to exactly this set. Keep PLAID_PRIMARY_MAP in sync when
 * editing this list.
 */
export const DEFAULT_CATEGORIES: { name: string; color: string; type: 'expense' | 'income' }[] = [
  { name: 'Income', color: '#16a34a', type: 'income' },
  { name: 'Groceries', color: '#22c55e', type: 'expense' },
  { name: 'Dining & Drinks', color: '#f97316', type: 'expense' },
  { name: 'Shopping', color: '#ec4899', type: 'expense' },
  { name: 'Transportation', color: '#3b82f6', type: 'expense' },
  { name: 'Travel', color: '#06b6d4', type: 'expense' },
  { name: 'Bills & Utilities', color: '#eab308', type: 'expense' },
  { name: 'Rent & Housing', color: '#8b5cf6', type: 'expense' },
  { name: 'Health & Medical', color: '#ef4444', type: 'expense' },
  { name: 'Personal Care', color: '#d946ef', type: 'expense' },
  { name: 'Entertainment', color: '#a855f7', type: 'expense' },
  { name: 'Services', color: '#0ea5e9', type: 'expense' },
  { name: 'Fees & Charges', color: '#64748b', type: 'expense' },
  { name: 'Loan Payments', color: '#78716c', type: 'expense' },
  { name: 'Transfers', color: '#94a3b8', type: 'expense' },
  { name: 'Government & Non-Profit', color: '#0d9488', type: 'expense' },
  { name: 'Other', color: '#9ca3af', type: 'expense' },
];

/**
 * Insert any default categories that don't already exist (matched by name).
 * Idempotent: safe to run on every boot and won't clobber user edits.
 */
export async function seedDefaultCategories(): Promise<number> {
  const existing = await db.select({ name: budgetCategories.name }).from(budgetCategories);
  const have = new Set(existing.map((c) => c.name));
  const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.name));
  if (missing.length) {
    await db.insert(budgetCategories).values(missing);
  }
  return missing.length;
}

// Allow running directly: `ts-node src/db/seedCategories.ts`
if (require.main === module) {
  import('dotenv').then(({ config }) => {
    config({ path: require('path').resolve(__dirname, '../../../.env') });
    seedDefaultCategories()
      .then((n) => {
        console.log(`Seeded ${n} new categories.`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
}
