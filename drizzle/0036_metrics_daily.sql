CREATE TABLE IF NOT EXISTS "chef_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"hours_worked_minutes" integer DEFAULT 0 NOT NULL,
	"pay_cents" integer DEFAULT 0 NOT NULL,
	"revenue_cents" integer DEFAULT 0 NOT NULL,
	"margin_cents" integer DEFAULT 0 NOT NULL,
	"completed_shifts" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"proposals_accepted" integer DEFAULT 0 NOT NULL,
	"proposals_rejected" integer DEFAULT 0 NOT NULL,
	"cancellations" integer DEFAULT 0 NOT NULL,
	"hours_submitted" integer DEFAULT 0 NOT NULL,
	"response_seconds_sum" integer DEFAULT 0 NOT NULL,
	"response_seconds_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_metrics_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"shifts_count" integer DEFAULT 0 NOT NULL,
	"slots_count" integer DEFAULT 0 NOT NULL,
	"filled_slots" integer DEFAULT 0 NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"chef_pay_cents" integer DEFAULT 0 NOT NULL,
	"margin_cents" integer DEFAULT 0 NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"approval_sla_minutes_sum" integer DEFAULT 0 NOT NULL,
	"approval_sla_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_metrics_daily" ADD CONSTRAINT "chef_metrics_daily_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_metrics_daily" ADD CONSTRAINT "client_metrics_daily_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chef_metrics_daily_chef_date_idx" ON "chef_metrics_daily" USING btree ("chef_id","snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_metrics_daily_date_idx" ON "chef_metrics_daily" USING btree ("snapshot_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_metrics_daily_client_date_idx" ON "client_metrics_daily" USING btree ("client_id","snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_metrics_daily_date_idx" ON "client_metrics_daily" USING btree ("snapshot_date");