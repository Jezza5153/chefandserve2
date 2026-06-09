CREATE TYPE "public"."ai_feedback_verdict" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"channel" text DEFAULT 'owner' NOT NULL,
	"verdict" "ai_feedback_verdict" NOT NULL,
	"question" text,
	"answer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_feedback_created_idx" ON "ai_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_feedback_verdict_idx" ON "ai_feedback" USING btree ("verdict");