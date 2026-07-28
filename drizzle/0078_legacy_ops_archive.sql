CREATE TABLE IF NOT EXISTS "legacy_client_months" (
	"id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"client_id" text,
	"month" date NOT NULL,
	"shifts" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'shiftmanager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legacy_ops_days" (
	"day" date PRIMARY KEY NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"slots_filled" integer DEFAULT 0 NOT NULL,
	"slots_total" integer DEFAULT 0 NOT NULL,
	"hours_filled" integer DEFAULT 0 NOT NULL,
	"hours_total" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'shiftmanager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legacy_client_months" ADD CONSTRAINT "legacy_client_months_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_client_months_unique" ON "legacy_client_months" USING btree ("client_name","month");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_client_months_client_idx" ON "legacy_client_months" USING btree ("client_id");