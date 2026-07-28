CREATE TYPE "public"."betaalbatch_status" AS ENUM('concept', 'generated', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "betaalbatch_regels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"chef_id" text NOT NULL,
	"chef_invoice_id" uuid,
	"bedrag_cents" integer NOT NULL,
	"omschrijving" text NOT NULL,
	"naam_snapshot" text NOT NULL,
	"iban_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "betaalbatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nummer" text NOT NULL,
	"status" "betaalbatch_status" DEFAULT 'concept' NOT NULL,
	"uitvoer_datum" date NOT NULL,
	"aantal_regels" integer DEFAULT 0 NOT NULL,
	"totaal_cents" integer DEFAULT 0 NOT NULL,
	"bestand_checksum" text,
	"gegenereerd_op" timestamp with time zone,
	"betaald_op" timestamp with time zone,
	"betaald_door" text,
	"notitie" text,
	"aangemaakt_door" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "betaalbatches_nummer_unique" UNIQUE("nummer")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "betaalbatch_regels" ADD CONSTRAINT "betaalbatch_regels_batch_id_betaalbatches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."betaalbatches"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "betaalbatch_regels" ADD CONSTRAINT "betaalbatch_regels_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "betaalbatch_regels" ADD CONSTRAINT "betaalbatch_regels_chef_invoice_id_chef_invoices_id_fk" FOREIGN KEY ("chef_invoice_id") REFERENCES "public"."chef_invoices"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "betaalbatches" ADD CONSTRAINT "betaalbatches_betaald_door_users_id_fk" FOREIGN KEY ("betaald_door") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "betaalbatches" ADD CONSTRAINT "betaalbatches_aangemaakt_door_users_id_fk" FOREIGN KEY ("aangemaakt_door") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "betaalbatch_regels_invoice_unique" ON "betaalbatch_regels" USING btree ("chef_invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "betaalbatch_regels_batch_idx" ON "betaalbatch_regels" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "betaalbatches_status_idx" ON "betaalbatches" USING btree ("status","uitvoer_datum");