CREATE TYPE "public"."chef_onboarding_status" AS ENUM('not_started', 'in_progress', 'submitted');--> statement-breakpoint
CREATE TYPE "public"."form_field_kind" AS ENUM('system', 'custom');--> statement-breakpoint
CREATE TYPE "public"."form_field_type" AS ENUM('text', 'textarea', 'email', 'phone', 'number', 'date', 'select', 'multiselect', 'checkbox', 'boolean', 'file', 'iban', 'bsn', 'postcode', 'country', 'heading');--> statement-breakpoint
CREATE TYPE "public"."form_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."reminder_channel" AS ENUM('email', 'in_app', 'both');--> statement-breakpoint
CREATE TYPE "public"."reminder_trigger" AS ENUM('chef_birthday', 'id_document_expiry', 'certificate_expiry', 'chef_inactivity', 'custom_date');--> statement-breakpoint
ALTER TYPE "public"."chef_document_type" ADD VALUE 'bsn_registration';--> statement-breakpoint
ALTER TYPE "public"."chef_document_type" ADD VALUE 'id_copy_front';--> statement-breakpoint
ALTER TYPE "public"."chef_document_type" ADD VALUE 'id_copy_back';--> statement-breakpoint
ALTER TYPE "public"."chef_document_type" ADD VALUE 'bank_card';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_field_values" (
	"id" text PRIMARY KEY NOT NULL,
	"chef_id" text NOT NULL,
	"field_id" text NOT NULL,
	"field_key" text NOT NULL,
	"value_text" text,
	"value_number" numeric(14, 4),
	"value_boolean" boolean,
	"value_date" date,
	"value_json" jsonb,
	"document_id" text,
	"is_encrypted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"section_id" text NOT NULL,
	"kind" "form_field_kind" DEFAULT 'custom' NOT NULL,
	"system_key" text,
	"type" "form_field_type" NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"placeholder" text,
	"required" boolean DEFAULT false NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" jsonb,
	"validation" jsonb,
	"document_type" "chef_document_type",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"form_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "forms" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"audience" text DEFAULT 'chef' NOT NULL,
	"status" "form_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"trigger_type" "reminder_trigger" NOT NULL,
	"lead_days" integer DEFAULT 0 NOT NULL,
	"channel" "reminder_channel" DEFAULT 'email' NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"recipient_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"notify_subject_chef" boolean DEFAULT false NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reminder_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"chef_id" text,
	"occurrence_key" text NOT NULL,
	"target_date" date,
	"channel" "reminder_channel" NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "infix" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "surname" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "initials" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "place_of_residence" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "id_type" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "id_number_encrypted" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "id_expires_at" date;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "bsn_encrypted" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "iban_encrypted" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "bank_account_holder_name" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "loonheffingskorting" boolean;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "stipp_participated" boolean;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "stipp_months" integer;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "worked_for_client_last_6mo" boolean;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "own_transport" boolean;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "likes_most" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "recent_venues" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "onboarding_status" "chef_onboarding_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "onboarding_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "onboarding_form_version" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_field_values" ADD CONSTRAINT "chef_field_values_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_field_values" ADD CONSTRAINT "chef_field_values_field_id_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_field_values" ADD CONSTRAINT "chef_field_values_document_id_chef_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."chef_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_section_id_form_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."form_sections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_rules" ADD CONSTRAINT "reminder_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_rule_id_reminder_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."reminder_rules"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reminder_sends" ADD CONSTRAINT "reminder_sends_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chef_field_values_chef_field_unique" ON "chef_field_values" USING btree ("chef_id","field_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chef_field_values_field_key_idx" ON "chef_field_values" USING btree ("field_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_fields_section_idx" ON "form_fields" USING btree ("section_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_fields_form_key_unique" ON "form_fields" USING btree ("form_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_fields_form_system_key_unique" ON "form_fields" USING btree ("form_id","system_key") WHERE "form_fields"."system_key" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_sections_form_idx" ON "form_sections" USING btree ("form_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forms_slug_unique" ON "forms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_rules_enabled_idx" ON "reminder_rules" USING btree ("enabled","trigger_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_sends_dedupe" ON "reminder_sends" USING btree ("rule_id","chef_id","occurrence_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_sends_dedupe_null_chef" ON "reminder_sends" USING btree ("rule_id","occurrence_key") WHERE "reminder_sends"."chef_id" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminder_sends_rule_idx" ON "reminder_sends" USING btree ("rule_id","sent_at");