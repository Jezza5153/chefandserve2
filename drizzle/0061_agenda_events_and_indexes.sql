DO $$ BEGIN
 CREATE TYPE "public"."agenda_event_status" AS ENUM('open', 'done', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."agenda_event_type" AS ENUM('intake_call', 'follow_up', 'onboarding_task', 'contract_start', 'internal_reminder');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agenda_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "agenda_event_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"title" text NOT NULL,
	"notes" text,
	"linked_client_id" text,
	"linked_chef_id" text,
	"linked_shift_id" text,
	"assigned_to" text,
	"status" "agenda_event_status" DEFAULT 'open' NOT NULL,
	"checklist" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_events_linked_client_id_clients_id_fk" FOREIGN KEY ("linked_client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_events_linked_chef_id_chefs_id_fk" FOREIGN KEY ("linked_chef_id") REFERENCES "public"."chefs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_events_linked_shift_id_shifts_id_fk" FOREIGN KEY ("linked_shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_events_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agenda_events" ADD CONSTRAINT "agenda_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_events_starts_idx" ON "agenda_events" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agenda_events_client_idx" ON "agenda_events" USING btree ("linked_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_logs_entity_idx" ON "contact_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "placements_status_idx" ON "placements" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hours_shift_id_idx" ON "shift_hours" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hours_submitted_idx" ON "shift_hours" USING btree ("status","submitted_at");