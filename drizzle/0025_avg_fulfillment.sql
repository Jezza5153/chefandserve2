CREATE TYPE "public"."privacy_channel" AS ENUM('portal', 'email', 'phone', 'whatsapp', 'letter');--> statement-breakpoint
CREATE TYPE "public"."privacy_identity_status" AS ENUM('not_started', 'requested', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."privacy_message_direction" AS ENUM('inbound', 'outbound', 'internal_note');--> statement-breakpoint
CREATE TYPE "public"."privacy_requester_kind" AS ENUM('chef', 'klant', 'unknown', 'external');--> statement-breakpoint
ALTER TYPE "public"."privacy_request_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."privacy_request_type" ADD VALUE 'other';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "privacy_request_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privacy_request_id" uuid NOT NULL,
	"direction" "privacy_message_direction" NOT NULL,
	"channel" "privacy_channel" NOT NULL,
	"body" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" DROP CONSTRAINT "privacy_requests_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "privacy_requests" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "requester_kind" "privacy_requester_kind";--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "requester_name" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "requester_email" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "requester_phone" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "original_channel" "privacy_channel" DEFAULT 'portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "raw_request_text" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "identity_status" "privacy_identity_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "identity_method" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "identity_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "identity_verified_by" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "identity_notes" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "sla_extended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "sla_extended_by" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "sla_extension_reason" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "sla_extension_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "correction_scope" jsonb;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "correction_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "correction_applied_by" text;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD COLUMN "response_file_key" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_request_messages" ADD CONSTRAINT "privacy_request_messages_privacy_request_id_privacy_requests_id_fk" FOREIGN KEY ("privacy_request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_request_messages" ADD CONSTRAINT "privacy_request_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_request_messages_request_idx" ON "privacy_request_messages" USING btree ("privacy_request_id","created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_identity_verified_by_users_id_fk" FOREIGN KEY ("identity_verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_sla_extended_by_users_id_fk" FOREIGN KEY ("sla_extended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_correction_applied_by_users_id_fk" FOREIGN KEY ("correction_applied_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
