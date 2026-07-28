CREATE TYPE "public"."surcharge_rule_kind" AS ENUM('time_window', 'weekday', 'holiday', 'spoed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_hour_surcharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_hours_id" uuid NOT NULL,
	"rule_id" uuid,
	"rule_code" text NOT NULL,
	"label" text NOT NULL,
	"minutes" integer NOT NULL,
	"client_pct_bps" integer NOT NULL,
	"chef_pct_bps" integer NOT NULL,
	"base_client_rate_cents" integer NOT NULL,
	"base_chef_rate_cents" integer NOT NULL,
	"client_amount_cents" integer NOT NULL,
	"chef_amount_cents" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "surcharge_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" "surcharge_rule_kind" NOT NULL,
	"start_minute_of_day" integer,
	"end_minute_of_day" integer,
	"weekdays" integer[],
	"lead_time_hours" integer,
	"client_pct_bps" integer DEFAULT 0 NOT NULL,
	"chef_pct_bps" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surcharge_rules_code_unique" UNIQUE("code")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_surcharges" ADD CONSTRAINT "shift_hour_surcharges_shift_hours_id_shift_hours_id_fk" FOREIGN KEY ("shift_hours_id") REFERENCES "public"."shift_hours"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_surcharges" ADD CONSTRAINT "shift_hour_surcharges_rule_id_surcharge_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."surcharge_rules"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "surcharge_rules" ADD CONSTRAINT "surcharge_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_hour_surcharges_hours_rule_unique" ON "shift_hour_surcharges" USING btree ("shift_hours_id","rule_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_hour_surcharges_hours_idx" ON "shift_hour_surcharges" USING btree ("shift_hours_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "surcharge_rules_enabled_idx" ON "surcharge_rules" USING btree ("enabled","priority");