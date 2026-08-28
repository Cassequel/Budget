ALTER TABLE "transactions" ADD COLUMN "flow_type" text DEFAULT 'spending' NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_flow_type_idx" ON "transactions" USING btree ("flow_type");