CREATE TABLE IF NOT EXISTS "privacy_erasure_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"privacy_request_id" uuid,
	"original_user_id" text,
	"original_chef_id" text,
	"original_client_id" text,
	"hashed_email" text,
	"requester_kind" "privacy_requester_kind",
	"erased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erased_by" text,
	"reason" text,
	"retained_entities_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_erasure_tombstones" ADD CONSTRAINT "privacy_erasure_tombstones_privacy_request_id_privacy_requests_id_fk" FOREIGN KEY ("privacy_request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "privacy_erasure_tombstones" ADD CONSTRAINT "privacy_erasure_tombstones_erased_by_users_id_fk" FOREIGN KEY ("erased_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_erasure_tombstones_hashed_email_idx" ON "privacy_erasure_tombstones" USING btree ("hashed_email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_erasure_tombstones_user_idx" ON "privacy_erasure_tombstones" USING btree ("original_user_id");