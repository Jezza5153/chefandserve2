CREATE TABLE IF NOT EXISTS "chef_client_history" (
	"id" text PRIMARY KEY NOT NULL,
	"chef_id" text NOT NULL,
	"client_id" text NOT NULL,
	"legacy_invites" integer DEFAULT 0 NOT NULL,
	"legacy_minutes" integer DEFAULT 0 NOT NULL,
	"legacy_rating" numeric(4, 2),
	"legacy_rating_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'shiftmanager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_client_history" ADD CONSTRAINT "chef_client_history_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_client_history" ADD CONSTRAINT "chef_client_history_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chef_client_history_pair_unique" ON "chef_client_history" USING btree ("chef_id","client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_client_history_client_idx" ON "chef_client_history" USING btree ("client_id");