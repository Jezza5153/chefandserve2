ALTER TABLE "payroll_batch_lines" ALTER COLUMN "shift_hours_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chef_expense_claims" ADD COLUMN "sell_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "chef_expense_claims" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "chef_expense_claims" ADD COLUMN "invoice_line_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_batch_lines" ADD COLUMN "expense_claim_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_expense_claims" ADD CONSTRAINT "chef_expense_claims_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_batch_lines" ADD CONSTRAINT "payroll_batch_lines_expense_claim_id_chef_expense_claims_id_fk" FOREIGN KEY ("expense_claim_id") REFERENCES "public"."chef_expense_claims"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
