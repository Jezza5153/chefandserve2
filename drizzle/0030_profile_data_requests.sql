CREATE TABLE IF NOT EXISTS "profile_data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chef_id" text NOT NULL,
	"request_type" text DEFAULT 'profile_update' NOT NULL,
	"requested_fields" text[],
	"channel" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_to" text,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text,
	"message_template_key" text,
	"jotform_submission_id" text,
	"contact_log_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_data_requests" ADD CONSTRAINT "profile_data_requests_chef_id_chefs_id_fk" FOREIGN KEY ("chef_id") REFERENCES "public"."chefs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_data_requests" ADD CONSTRAINT "profile_data_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_data_requests_chef_idx" ON "profile_data_requests" USING btree ("chef_id","status");