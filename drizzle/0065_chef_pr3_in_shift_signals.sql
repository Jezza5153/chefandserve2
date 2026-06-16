DO $$ BEGIN
 CREATE TYPE "public"."shift_signal_kind" AS ENUM('onderweg', 'vertraagd', 'hulp', 'onveilig', 'kan_niet_starten');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"shift_id" text NOT NULL,
	"kind" "shift_signal_kind" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_signals" ADD CONSTRAINT "shift_signals_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_signals" ADD CONSTRAINT "shift_signals_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_signals" ADD CONSTRAINT "shift_signals_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_signals_placement_idx" ON "shift_signals" USING btree ("placement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_signals_shift_idx" ON "shift_signals" USING btree ("shift_id");