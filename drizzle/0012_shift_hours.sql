CREATE TYPE "public"."shift_hours_status" AS ENUM('draft', 'submitted', 'client_signed', 'client_rejected', 'admin_approved', 'admin_rejected', 'exported', 'void');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"client_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"break_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer NOT NULL,
	"chef_rate_cents" integer NOT NULL,
	"client_rate_cents" integer NOT NULL,
	"chef_notes" text,
	"client_notes" text,
	"admin_notes" text,
	"status" "shift_hours_status" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"client_signed_at" timestamp with time zone,
	"client_signed_by" text,
	"client_rejected_at" timestamp with time zone,
	"admin_approved_at" timestamp with time zone,
	"admin_approved_by" text,
	"admin_rejected_at" timestamp with time zone,
	"payingit_exported_at" timestamp with time zone,
	"payingit_export_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_hours_placement_id_unique" UNIQUE("placement_id"),
	CONSTRAINT "shift_hours_end_after_start" CHECK ("shift_hours"."ended_at" > "shift_hours"."started_at"),
	CONSTRAINT "shift_hours_break_non_negative" CHECK ("shift_hours"."break_minutes" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_client_signed_by_users_id_fk" FOREIGN KEY ("client_signed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hours" ADD CONSTRAINT "shift_hours_admin_approved_by_users_id_fk" FOREIGN KEY ("admin_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hours_status_idx" ON "shift_hours" USING btree ("status","client_signed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hours_chef_idx" ON "shift_hours" USING btree ("chef_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hours_client_idx" ON "shift_hours" USING btree ("client_id","status");