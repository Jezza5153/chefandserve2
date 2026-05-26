CREATE TYPE "public"."placement_status" AS ENUM('proposed', 'accepted', 'rejected', 'confirmed', 'cancelled', 'no_show', 'completed');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('request', 'open', 'filled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "placements" (
	"id" text PRIMARY KEY NOT NULL,
	"shift_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"status" "placement_status" DEFAULT 'proposed' NOT NULL,
	"chef_rate_cents" integer,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"proposed_by" text,
	"notes" text,
	"match_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shifts" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"when_description" text,
	"role_needed" "vakniveau" NOT NULL,
	"segment" "segment",
	"headcount" integer DEFAULT 1 NOT NULL,
	"location" text,
	"city" text,
	"client_rate_cents" integer,
	"chef_rate_cents" integer,
	"status" "shift_status" DEFAULT 'request' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "placements" ADD CONSTRAINT "placements_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "placements_chef_shift_unique" ON "placements" USING btree ("chef_id","shift_id");