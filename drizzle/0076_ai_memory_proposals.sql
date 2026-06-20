DO $$ BEGIN
 CREATE TYPE "public"."ai_memory_proposal_status" AS ENUM('pending', 'accepted', 'dismissed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_memory_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fact" text NOT NULL,
	"fact_norm" text NOT NULL,
	"status" "ai_memory_proposal_status" DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'mining' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_memory_proposals" ADD CONSTRAINT "ai_memory_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_memory_proposals_user_status_idx" ON "ai_memory_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_memory_proposals_pending_uq" ON "ai_memory_proposals" USING btree ("user_id","fact_norm") WHERE "ai_memory_proposals"."status" = 'pending';