CREATE TYPE "public"."client_contact_role" AS ENUM('planning', 'onsite', 'finance', 'hours_approval', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."comment_author_kind" AS ENUM('client', 'admin', 'chef', 'system');--> statement-breakpoint
CREATE TYPE "public"."comment_visibility" AS ENUM('internal', 'client_visible', 'chef_visible');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" "client_contact_role" NOT NULL,
	"receives_notifications" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placement_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" text NOT NULL,
	"author_user_id" text,
	"author_kind" "comment_author_kind" NOT NULL,
	"visibility" "comment_visibility" NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "placement_comments_body_len" CHECK (char_length("placement_comments"."body") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "shift_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "shift_arrival_notes" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "billing_address" text;--> statement-breakpoint
-- PR-KLANT-0 backfill: the legacy ambiguous "address" most often meant the
-- shift location, so seed shift_address from it. billing_address stays null
-- (admin fills it via the request-change flow when invoicing needs it).
UPDATE "clients" SET "shift_address" = "address" WHERE "shift_address" IS NULL AND "address" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placement_comments" ADD CONSTRAINT "placement_comments_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placement_comments" ADD CONSTRAINT "placement_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contacts_client_idx" ON "client_contacts" USING btree ("client_id","role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_comments_placement_idx" ON "placement_comments" USING btree ("placement_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placement_comments_visibility_idx" ON "placement_comments" USING btree ("placement_id","visibility");