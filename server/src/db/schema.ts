import {
  pgTable,
  text,
  decimal,
  boolean,
  date,
  timestamp,
  uuid,
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  plaidTransactionId: text('plaid_transaction_id').notNull().unique(),
  accountId: uuid('account_id').references(() => accounts.id),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  date: date('date').notNull(),
  name: text('name').notNull(),
  merchantName: text('merchant_name'),
  category: text('category'),
  plaidCategory: text('plaid_category'),
  isPending: boolean('is_pending').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
