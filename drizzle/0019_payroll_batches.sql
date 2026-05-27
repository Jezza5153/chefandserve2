CREATE TYPE "public"."payroll_batch_status" AS ENUM('draft', 'exported', 'partially_failed', 'corrected', 'void');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_batch_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"shift_hours_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"client_amount_cents" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"provider" text DEFAULT 'csv' NOT NULL,
	"status" "payroll_batch_status" DEFAULT 'draft' NOT NULL,
	"file_url" text,
	"file_checksum" text,
	"row_count" integer,
	"total_chef_cost_cents" integer,
	"total_client_revenue_cents" integer,
	"total_margin_cents" integer,
	"exported_at" timestamp with time zone,
	"exported_by" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_hour_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_shift_hours_id" uuid NOT NULL,
	"correction_type" text NOT NULL,
	"reason" text NOT NULL,
	"delta_worked_minutes" integer,
	"delta_chef_amount_cents" integer,
	"delta_client_amount_cents" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_batch_lines" ADD CONSTRAINT "payroll_batch_lines_batch_id_payroll_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."payroll_batches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_batch_lines" ADD CONSTRAINT "payroll_batch_lines_shift_hours_id_shift_hours_id_fk" FOREIGN KEY ("shift_hours_id") REFERENCES "public"."shift_hours"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_batches" ADD CONSTRAINT "payroll_batches_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_corrections" ADD CONSTRAINT "shift_hour_corrections_original_shift_hours_id_shift_hours_id_fk" FOREIGN KEY ("original_shift_hours_id") REFERENCES "public"."shift_hours"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_corrections" ADD CONSTRAINT "shift_hour_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_corrections" ADD CONSTRAINT "shift_hour_corrections_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
