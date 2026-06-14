CREATE TABLE IF NOT EXISTS "shift_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" text NOT NULL,
	"chef_id" text NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_interests" ADD CONSTRAINT "shift_interests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_interests" ADD CONSTRAINT "shift_interests_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_interests_unique" ON "shift_interests" USING btree ("shift_id","chef_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_interests_shift_idx" ON "shift_interests" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_interests_chef_idx" ON "shift_interests" USING btree ("chef_id");