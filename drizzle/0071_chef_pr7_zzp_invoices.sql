DO $$ BEGIN
 CREATE TYPE "public"."chef_invoice_status" AS ENUM('concept', 'submitted', 'approved', 'paid', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"status" "chef_invoice_status" DEFAULT 'concept' NOT NULL,
	"amount_cents" integer NOT NULL,
	"period_from" date,
	"period_to" date,
	"reference" text,
	"note" text,
	"invoice_r2_key" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_note" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_invoices" ADD CONSTRAINT "chef_invoices_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_invoices" ADD CONSTRAINT "chef_invoices_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_invoices_chef_idx" ON "chef_invoices" USING btree ("chef_id","status");