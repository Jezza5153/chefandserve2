CREATE TABLE IF NOT EXISTS "match_intel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"client_id" text NOT NULL,
	"note" text,
	"would_rehire" boolean,
	"would_return" boolean,
	"ai_why_works" text,
	"ai_why_fails" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "chef_return_signal" boolean;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_intel" ADD CONSTRAINT "match_intel_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_intel" ADD CONSTRAINT "match_intel_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_intel" ADD CONSTRAINT "match_intel_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "match_intel_chef_client_unique" ON "match_intel" USING btree ("chef_id","client_id");