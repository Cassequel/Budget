import {
  pgTable,
  text,
  decimal,
  integer,
  boolean,
  date,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const plaidItems = pgTable('plaid_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  itemId: text('item_id').notNull().unique(),
  accessTokenEncrypted: text('access_token_encrypted').notNull(),
  institutionId: text('institution_id'),
  institutionName: text('institution_name'),
  cursor: text('cursor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  plaidItemId: uuid('plaid_item_id').references(() => plaidItems.id),
  plaidAccountId: text('plaid_account_id').notNull().unique(),
  name: text('name').notNull(),
  officialName: text('official_name'),
  type: text('type').notNull(),
  subtype: text('subtype'),
  mask: text('mask'),
  currentBalance: decimal('current_balance', { precision: 12, scale: 2 }),
  availableBalance: decimal('available_balance', { precision: 12, scale: 2 }),
  currencyCode: text('currency_code').default('USD'),
  institutionName: text('institution_name'),
  // How this account's cash counts toward the operating plan:
  //   'spending'  – liquid cash available for the $X/mo baseline & "can I afford this"
  //   'reserve'   – part of the no-touch cash reserve (counts toward the reserve
  //                 target, excluded from spendable cash)
  //   'excluded'  – ignored in every cash calculation (e.g. an investment sub-account)
  // Credit/loan accounts ignore this — they're always treated as liabilities.
  cashRole: text('cash_role').notNull().default('spending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    plaidTransactionId: text('plaid_transaction_id').notNull().unique(),
    accountId: uuid('account_id').references(() => accounts.id),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    date: date('date').notNull(),
    name: text('name').notNull(),
    merchantName: text('merchant_name'),
    category: text('category'),
    plaidCategory: text('plaid_category'),
    plaidCategoryDetailed: text('plaid_category_detailed'),
    // Deterministic classification of what kind of money movement this is —
    // derived from Plaid's personal_finance_category, independent of the
    // (partly LLM-assigned) display `category`. Drives every spend/income/
    // runway aggregate. See server/src/flowType.ts.
    flowType: text('flow_type').notNull().default('spending'),
    isPending: boolean('is_pending').default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('transactions_date_idx').on(table.date),
    index('transactions_account_id_idx').on(table.accountId),
    index('transactions_category_idx').on(table.category),
    index('transactions_flow_type_idx').on(table.flowType),
  ]
);

export const budgetCategories = pgTable('budget_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  monthlyLimit: decimal('monthly_limit', { precision: 12, scale: 2 }),
  color: text('color').default('#6366f1'),
  icon: text('icon'),
  type: text('type').notNull().default('expense'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  targetDate: date('target_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const planItems = pgTable('plan_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').references(() => plans.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  dueDate: date('due_date'),
  isPaid: boolean('is_paid').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const savingsGoals = pgTable('savings_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  targetAmount: decimal('target_amount', { precision: 12, scale: 2 }).notNull(),
  currentAmount: decimal('current_amount', { precision: 12, scale: 2 }).default('0'),
  targetDate: date('target_date'),
  linkedAccountId: uuid('linked_account_id').references(() => accounts.id),
  // Operating-plan fields: lower `priority` number = funded sooner in the
  // allocation waterfall. `fundingSource` and `why` are free text (an account
  // name, "UGC surplus", the reason the goal matters).
  priority: integer('priority').notNull().default(100),
  fundingSource: text('funding_source'),
  why: text('why'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// The single household operating plan — the personal rules the whole app runs
// against. One row; the GET handler creates it on first read.
export const operatingPlan = pgTable('operating_plan', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Conservative monthly cost to stay afloat: bills, food, subs, utilities,
  // card minimums. Drives months-of-coverage and the "can I afford this" math.
  monthlySurvivalCost: decimal('monthly_survival_cost', { precision: 12, scale: 2 }),
  // No-touch cash cushion to build toward, separate from credit paydown.
  cashReserveTarget: decimal('cash_reserve_target', { precision: 12, scale: 2 }),
  // 'variable' (UGC/freelance), 'fixed' (steady paycheck), or 'mixed'.
  incomeType: text('income_type').notNull().default('variable'),
  incomeNotes: text('income_notes'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// User-entered credit-card terms Plaid doesn't reliably expose (limit, minimum,
// due/close dates, APR, promo expiry). One row per card; `accountId` links to a
// Plaid account for the live balance, or is null for a manually tracked card.
export const creditCards = pgTable('credit_cards', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  creditLimit: decimal('credit_limit', { precision: 12, scale: 2 }),
  // Balance as of the last statement — utilization is usually reported on this.
  // Falls back to the live account balance when null.
  statementBalance: decimal('statement_balance', { precision: 12, scale: 2 }),
  minimumPayment: decimal('minimum_payment', { precision: 12, scale: 2 }),
  dueDate: date('due_date'),
  statementCloseDate: date('statement_close_date'),
  apr: decimal('apr', { precision: 5, scale: 2 }),
  promoAprExpiry: date('promo_apr_expiry'),
  autopayMinimum: boolean('autopay_minimum').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
