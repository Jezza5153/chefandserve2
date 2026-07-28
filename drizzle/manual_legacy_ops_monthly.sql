-- HANDMATIGE migratie — bewust BUITEN drizzle/meta/_journal.json.
--
-- Waarom hier en niet als 0079: dit bestand is met de hand geschreven (drizzle-kit
-- bleef hangen op zijn interactieve hernoem-vraag) en dus nooit door db:generate
-- gegaan, waardoor er ook geen 0079-snapshot bestaat. Zolang het als 0079_*.sql op
-- schijf lag, zou de eerstvolgende db:generate een botsende 0079 wegschrijven. De
-- manual_*-conventie (zie .claude/rules/db-and-migrations.md) is precies hiervoor.
--
-- Al toegepast op dev EN prod op 2026-07-28, geverifieerd via information_schema.
-- Idempotent: opnieuw draaien is onschadelijk.
--
-- Vervangt de dagelijkse variant uit 0078 door de granulariteit die we ook echt
-- volledig kunnen overzetten: per maand. Beide 0078-tabellen waren leeg.
DROP TABLE IF EXISTS "legacy_client_months";--> statement-breakpoint
DROP TABLE IF EXISTS "legacy_ops_days";--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legacy_ops_months" (
	"month" date PRIMARY KEY NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"slots_filled" integer DEFAULT 0 NOT NULL,
	"slots_total" integer DEFAULT 0 NOT NULL,
	"hours_filled" integer DEFAULT 0 NOT NULL,
	"hours_total" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'shiftmanager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legacy_client_totals" (
	"id" text PRIMARY KEY NOT NULL,
	"client_name" text NOT NULL,
	"client_id" text,
	"shifts" integer DEFAULT 0 NOT NULL,
	"first_month" text NOT NULL,
	"last_month" text NOT NULL,
	"source" text DEFAULT 'shiftmanager' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "legacy_client_totals" ADD CONSTRAINT "legacy_client_totals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_client_totals_name_unique" ON "legacy_client_totals" USING btree ("client_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_client_totals_client_idx" ON "legacy_client_totals" USING btree ("client_id");
