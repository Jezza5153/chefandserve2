CREATE TYPE "public"."client_document_status" AS ENUM('uploaded', 'needs_review', 'verified', 'expired', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."client_document_type" AS ENUM('rie_document', 'other');--> statement-breakpoint
CREATE TYPE "public"."client_onboarding_status" AS ENUM('not_started', 'in_progress', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."client_rechtsvorm" AS ENUM('bv', 'nv', 'eenmanszaak', 'ander');--> statement-breakpoint
ALTER TYPE "public"."client_contact_role" ADD VALUE 'general_contact';--> statement-breakpoint
ALTER TYPE "public"."client_contact_role" ADD VALUE 'signing_authority';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"type" "client_document_type" DEFAULT 'other' NOT NULL,
	"filename" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" text,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"status" "client_document_status" DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "client_documents_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "handelsnaam" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "visit_street" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "visit_house_number" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "visit_postcode" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "visit_city" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "visit_country" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rechtsvorm" "client_rechtsvorm";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rsin" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "part_of_holding" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "holding_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cao_applicable" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "cao_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "own_work_regulations" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "inlenersbeloning" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pension_scheme" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "travel_cost_policy" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "overtime_policy" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rie_available" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "rie_date" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "workplace_safe" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "safety_instructions" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "pbm_required" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "vog_required" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "contract_start_date" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "primary_work_types" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "usual_needed_roles" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "main_shift_types" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "kitchen_language" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "chef_must_bring" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "parking_available" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "meal_included" boolean;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "work_clothing_required" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "onboarding_status" "client_onboarding_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "onboarding_form_version" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_contacts_client_role_unique" ON "client_contacts" USING btree ("client_id","role");