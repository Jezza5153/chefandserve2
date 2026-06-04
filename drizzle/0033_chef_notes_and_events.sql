CREATE TYPE "public"."chef_event_type" AS ENUM('proposal_accepted', 'proposal_rejected', 'hours_submitted', 'hours_rejected', 'availability_updated', 'shift_cancelled_by_chef');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"event_type" "chef_event_type" NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"response_seconds" integer,
	"delay_from_shift_end_min" integer,
	"worked_vs_scheduled_min" integer,
	"payload" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "chef_visible_notes" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "client_visible_notes" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_events" ADD CONSTRAINT "chef_events_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_events_chef_idx" ON "chef_events" USING btree ("chef_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_events_type_idx" ON "chef_events" USING btree ("event_type","occurred_at");