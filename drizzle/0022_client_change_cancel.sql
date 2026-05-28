CREATE TYPE "public"."client_shift_change_kind" AS ENUM('change', 'cancel');--> statement-breakpoint
CREATE TYPE "public"."client_shift_change_status" AS ENUM('pending', 'in_progress', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."submission_status" ADD VALUE 'cancelled_by_client';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_shift_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" text NOT NULL,
	"client_id" text NOT NULL,
	"requested_by" text,
	"kind" "client_shift_change_kind" NOT NULL,
	"reason" text NOT NULL,
	"proposed_change" jsonb,
	"status" "client_shift_change_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"decision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_submissions" ADD COLUMN "cancelled_by_client_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "client_submissions" ADD COLUMN "cancelled_by_client_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_shift_change_requests" ADD CONSTRAINT "client_shift_change_requests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_shift_change_requests" ADD CONSTRAINT "client_shift_change_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_shift_change_requests" ADD CONSTRAINT "client_shift_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_shift_change_requests" ADD CONSTRAINT "client_shift_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_shift_change_requests_client_idx" ON "client_shift_change_requests" USING btree ("client_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_shift_change_requests_shift_idx" ON "client_shift_change_requests" USING btree ("shift_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_shift_change_open_unique" ON "client_shift_change_requests" USING btree ("shift_id","kind") WHERE "client_shift_change_requests"."status" IN ('pending', 'in_progress');