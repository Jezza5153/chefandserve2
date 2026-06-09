CREATE TYPE "public"."inbound_category" AS ENUM('question', 'complaint', 'urgent', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'resend' NOT NULL,
	"provider_message_id" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_email" text,
	"subject" text,
	"body_preview" text,
	"matched_chef_id" text,
	"matched_client_id" text,
	"category" "inbound_category" DEFAULT 'other' NOT NULL,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_matched_chef_id_chefs_id_fk" FOREIGN KEY ("matched_chef_id") REFERENCES "public"."chefs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_matched_client_id_clients_id_fk" FOREIGN KEY ("matched_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_messages_created_idx" ON "inbound_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_messages_provider_msg_unique" ON "inbound_messages" USING btree ("provider_message_id");