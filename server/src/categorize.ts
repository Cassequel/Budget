import Anthropic from '@anthropic-ai/sdk';
import { db } from './db';
import { transactions, budgetCategories } from './db/schema';
import { isNull, inArray } from 'drizzle-orm';

/**
 * Hybrid auto-categorization:
 *   1. A deterministic map from Plaid's personal_finance_category.primary covers
 *      the obvious cases for free (no model call).
 *   2. Everything Plaid is ambiguous or silent about (FOOD_AND_DRINK could be
 *      groceries or dining, RENT_AND_UTILITIES could be rent or a utility bill,
 *      or Plaid returned no category at all) goes to Claude Haiku in a single
 *      batched call, constrained to the existing budget-category names.
 *
 * Only transactions with a NULL category are touched, so manual edits and prior
 * assignments are never overwritten.
 */

// Plaid primary → our category name. `null` means "ambiguous, ask the model".
// Keep the target names in sync with DEFAULT_CATEGORIES in db/seedCategories.ts.
const PLAID_PRIMARY_MAP: Record<string, string | null> = {
  INCOME: 'Income',
  TRANSFER_IN: 'Transfers',
  TRANSFER_OUT: 'Transfers',
  LOAN_PAYMENTS: 'Loan Payments',
  BANK_FEES: 'Fees & Charges',
  ENTERTAINMENT: 'Entertainment',
  FOOD_AND_DRINK: null, // groceries vs. dining — let the model decide
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Shopping',
  MEDICAL: 'Health & Medical',
  PERSONAL_CARE: 'Personal Care',
  GENERAL_SERVICES: 'Services',
  GOVERNMENT_AND_NON_PROFIT: 'Government & Non-Profit',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
  RENT_AND_UTILITIES: null, // rent vs. utilities — let the model decide
};

const MODEL = 'claude-haiku-4-5';
const BATCH_SIZE = 75;

type Uncat = {
  id: string;
  name: string;
  merchantName: string | null;
  amount: string;
  plaidCategory: string | null;
  plaidCategoryDetailed: string | null;
};

// Prevent overlapping runs (sync + manual button firing at once).
let inFlight: Promise<{ categorized: number; viaMap: number; viaModel: number }> | null = null;

export function categorizeUncategorized() {
  if (inFlight) return inFlight;
  inFlight = doCategorize().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doCategorize() {
  const validNames = new Set(
    (await db.select({ name: budgetCategories.name }).from(budgetCategories)).map((c) => c.name)
  );
  if (validNames.size === 0) return { categorized: 0, viaMap: 0, viaModel: 0 };

  const rows: Uncat[] = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantName: transactions.merchantName,
      amount: transactions.amount,
      plaidCategory: transactions.plaidCategory,
      plaidCategoryDetailed: transactions.plaidCategoryDetailed,
    })
    .from(transactions)
    .where(isNull(transactions.category));

  if (rows.length === 0) return { categorized: 0, viaMap: 0, viaModel: 0 };

  const assignments = new Map<string, string>(); // txn id → category name
  const ambiguous: Uncat[] = [];

  for (const tx of rows) {
    const mapped = tx.plaidCategory ? PLAID_PRIMARY_MAP[tx.plaidCategory] : undefined;
    if (mapped && validNames.has(mapped)) {
      assignments.set(tx.id, mapped);
    } else {
      ambiguous.push(tx);
    }
  }
  const viaMap = assignments.size;

  let viaModel = 0;
  if (ambiguous.length) {
    viaModel = await classifyWithModel(ambiguous, validNames, assignments);
  }

  // Persist. Group ids by assigned category so we issue one UPDATE per category.
  const byCategory = new Map<string, string[]>();
  for (const [id, cat] of assignments) {
    const list = byCategory.get(cat) ?? [];
    list.push(id);
    byCategory.set(cat, list);
  }
  for (const [cat, ids] of byCategory) {
    await db
      .update(transactions)
      .set({ category: cat, updatedAt: new Date() })
      .where(inArray(transactions.id, ids));
  }

  return { categorized: assignments.size, viaMap, viaModel };
}

async function classifyWithModel(
  items: Uncat[],
  validNames: Set<string>,
  out: Map<string, string>
): Promise<number> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const categoryList = [...validNames];
  let assigned = 0;

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    const lines = batch.map((tx, i) => {
      const amt = parseFloat(tx.amount);
      const direction = amt < 0 ? 'money in' : 'money out';
      const hints = [
        tx.merchantName ?? tx.name,
        tx.plaidCategory ? `plaid:${tx.plaidCategory}` : null,
        tx.plaidCategoryDetailed ? `detail:${tx.plaidCategoryDetailed}` : null,
        direction,
      ]
        .filter(Boolean)
        .join(' | ');
      return `${i}: ${hints}`;
    });

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              i: { type: 'integer' },
              category: { type: 'string', enum: categoryList },
            },
            required: ['i', 'category'],
          },
        },
      },
      required: ['results'],
    };

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system:
          'You categorize bank transactions into a fixed set of personal-budget categories. ' +
          'Pick the single best category for each numbered transaction from the allowed list. ' +
          'Use the merchant name and the Plaid hints. When unsure, choose "Other".',
        messages: [
          {
            role: 'user',
            content:
              `Allowed categories: ${categoryList.join(', ')}\n\n` +
              `Transactions:\n${lines.join('\n')}\n\n` +
              'Return a category for every transaction by its index.',
          },
        ],
        output_config: { format: { type: 'json_schema', schema } },
      });
    } catch (err) {
      console.error('Haiku categorization batch failed:', err);
      continue; // leave this batch uncategorized; a later run can retry
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let parsed: { results?: { i: number; category: string }[] };
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error('Could not parse categorization JSON:', text.slice(0, 200));
      continue;
    }

    for (const r of parsed.results ?? []) {
      const tx = batch[r.i];
      if (tx && validNames.has(r.category)) {
        out.set(tx.id, r.category);
        assigned++;
      }
    }
  }

  return assigned;
}
