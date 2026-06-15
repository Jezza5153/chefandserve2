CREATE TABLE IF NOT EXISTS "shift_hour_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"worked_planned_role" boolean,
	"worked_extra_hours" boolean,
	"got_break" boolean,
	"as_described" boolean,
	"issue_note" text,
	"would_return" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_reviews" ADD CONSTRAINT "shift_hour_reviews_placement_id_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_hour_reviews" ADD CONSTRAINT "shift_hour_reviews_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_hour_reviews_placement_unique" ON "shift_hour_reviews" USING btree ("placement_id");