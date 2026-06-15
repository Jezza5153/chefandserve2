DO $$ BEGIN
 CREATE TYPE "public"."chef_arrival_status" AS ENUM('monitoring', 'nearby', 'no_signal', 'permission_missing', 'stopped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_arrival_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"status" "chef_arrival_status" DEFAULT 'monitoring' NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"nearby_confirmed_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_arrival_checks" ADD CONSTRAINT "shift_arrival_checks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_arrival_checks" ADD CONSTRAINT "shift_arrival_checks_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_arrival_shift_chef_unique" ON "shift_arrival_checks" USING btree ("shift_id","chef_id");