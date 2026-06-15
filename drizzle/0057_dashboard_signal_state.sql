CREATE TABLE IF NOT EXISTS "dashboard_signal_state" (
	"signal_key" text PRIMARY KEY NOT NULL,
	"snooze_until" timestamp with time zone,
	"dismissed_reason" text,
	"fingerprint" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dashboard_signal_state" ADD CONSTRAINT "dashboard_signal_state_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
