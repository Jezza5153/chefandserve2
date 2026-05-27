CREATE TYPE "public"."chef_document_type" AS ENUM('cv', 'photo', 'certificate', 'id_document', 'other');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chef_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"chef_id" text NOT NULL,
	"type" "chef_document_type" DEFAULT 'other' NOT NULL,
	"filename" text NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "chef_documents_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_documents" ADD CONSTRAINT "chef_documents_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_documents" ADD CONSTRAINT "chef_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
