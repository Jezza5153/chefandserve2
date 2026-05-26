CREATE TYPE "public"."submission_status" AS ENUM('new', 'triaged', 'converted', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"source" text DEFAULT 'jotform' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"full_name" text,
	"email" text,
	"phone" text,
	"roles_requested" text,
	"years_experience" integer,
	"location_preference" text,
	"notes" text,
	"status" "submission_status" DEFAULT 'new' NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_by" text,
	"converted_to_chef_id" text,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_id" text NOT NULL,
	"source" text DEFAULT 'jotform' NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"company_name" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"role_requested" text,
	"segment" text,
	"date_needed" text,
	"headcount" integer,
	"location" text,
	"notes" text,
	"status" "submission_status" DEFAULT 'new' NOT NULL,
	"triaged_at" timestamp with time zone,
	"triaged_by" text,
	"converted_to_client_id" text,
	"rejected_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_submissions" ADD CONSTRAINT "chef_submissions_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_submissions" ADD CONSTRAINT "client_submissions_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chef_submissions_external_id_unique" ON "chef_submissions" USING btree ("source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_submissions_external_id_unique" ON "client_submissions" USING btree ("source","external_id");