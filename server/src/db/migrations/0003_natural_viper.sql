CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"credit_limit" numeric(12, 2),
	"statement_balance" numeric(12, 2),
	"minimum_payment" numeric(12, 2),
	"due_date" date,
	"statement_close_date" date,
	"apr" numeric(5, 2),
	"promo_apr_expiry" date,
	"autopay_minimum" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monthly_survival_cost" numeric(12, 2),
	"cash_reserve_target" numeric(12, 2),
	"income_type" text DEFAULT 'variable' NOT NULL,
	"income_notes" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "cash_role" text DEFAULT 'spending' NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "funding_source" text;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;