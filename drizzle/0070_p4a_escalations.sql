DO $$ BEGIN
 CREATE TYPE "public"."escalation_kind" AS ENUM('chef_cancelled_late', 'unassigned_soon', 'unconfirmed_near_start', 'chef_signal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."escalation_status" AS ENUM('open', 'in_progress', 'resolved', 'stood_down');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" text NOT NULL,
	"placement_id" text,
	"kind" "escalation_kind" NOT NULL,
	"status" "escalation_status" DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"opened_by" text,
	"resolved_by" text,
	"resolution_notes" text,
	"replacement_placement_id" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "escalations" ADD CONSTRAINT "escalations_replacement_placement_id_placements_id_fk" FOREIGN KEY ("replacement_placement_id") REFERENCES "public"."placements"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalations_shift_idx" ON "escalations" USING btree ("shift_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "escalations_status_idx" ON "escalations" USING btree ("status","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escalations_open_unique" ON "escalations" USING btree ("shift_id","kind") WHERE "escalations"."status" IN ('open', 'in_progress');