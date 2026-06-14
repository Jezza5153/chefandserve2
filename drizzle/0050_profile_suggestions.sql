CREATE TYPE "public"."profile_suggestion_field_class" AS ENUM('safe', 'sensitive');--> statement-breakpoint
CREATE TYPE "public"."profile_suggestion_source" AS ENUM('cv', 'completeness');--> statement-breakpoint
CREATE TYPE "public"."profile_suggestion_status" AS ENUM('pending', 'accepted', 'dismissed', 'superseded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"field" text NOT NULL,
	"field_class" "profile_suggestion_field_class" NOT NULL,
	"current_value" jsonb,
	"proposed_value" jsonb NOT NULL,
	"source" "profile_suggestion_source" NOT NULL,
	"confidence" numeric(3, 2),
	"source_hash" text,
	"status" "profile_suggestion_status" DEFAULT 'pending' NOT NULL,
	"created_by" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_suggestions" ADD CONSTRAINT "profile_suggestions_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_suggestions" ADD CONSTRAINT "profile_suggestions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_suggestions" ADD CONSTRAINT "profile_suggestions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_suggestions_chef_status_idx" ON "profile_suggestions" USING btree ("chef_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "profile_suggestions_pending_unique" ON "profile_suggestions" USING btree ("chef_id","field","source_hash") WHERE "profile_suggestions"."status" = 'pending';