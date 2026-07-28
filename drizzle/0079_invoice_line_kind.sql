CREATE TYPE "public"."invoice_line_kind" AS ENUM('hours', 'surcharge', 'expense', 'fee', 'discount', 'other');--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "kind" "invoice_line_kind" DEFAULT 'hours' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "vat_rate_bps" integer DEFAULT 2100 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "created_by" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
