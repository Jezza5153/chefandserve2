CREATE TYPE "public"."chef_status" AS ENUM('onboarding', 'active', 'paused', 'inactive', 'archived');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('prospect', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."segment" AS ENUM('casual', 'fine_dining', 'hotel', 'banqueting', 'catering', 'event', 'corporate', 'michelin');--> statement-breakpoint
CREATE TYPE "public"."vakniveau" AS ENUM('keukenhulp', 'bediening', 'host', 'runner', 'commis', 'chef_de_partie', 'sous_chef', 'chef_de_cuisine', 'executive_chef', 'patissier', 'banqueting', 'breakfast', 'roomservice', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"date" timestamp NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chefs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_submission_id" uuid,
	"user_id" text,
	"full_name" text NOT NULL,
	"email" text,
	"phone" text,
	"city" text,
	"vakniveau" "vakniveau",
	"segments" text[],
	"specialties" text,
	"years_experience" integer,
	"languages" text[],
	"hourly_rate_min_cents" integer,
	"hourly_rate_max_cents" integer,
	"payingit_employee_id" text,
	"status" "chef_status" DEFAULT 'onboarding' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"source_submission_id" uuid,
	"user_id" text,
	"company_name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"kvk" text,
	"btw" text,
	"billing_email" text,
	"payment_terms_days" integer DEFAULT 14,
	"segment" "segment",
	"address" text,
	"city" text,
	"payingit_client_id" text,
	"status" "client_status" DEFAULT 'prospect' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_availability" ADD CONSTRAINT "chef_availability_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chefs" ADD CONSTRAINT "chefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chefs" ADD CONSTRAINT "chefs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chef_availability_chef_date_unique" ON "chef_availability" USING btree ("chef_id","date");