CREATE TYPE "public"."chef_document_status" AS ENUM('uploaded', 'needs_review', 'verified', 'expired', 'rejected');--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "client_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "status" "chef_document_status" DEFAULT 'uploaded' NOT NULL;--> statement-breakpoint
ALTER TABLE "chef_documents" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chef_documents" ADD CONSTRAINT "chef_documents_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
