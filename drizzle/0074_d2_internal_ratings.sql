DO $$ BEGIN
 CREATE TYPE "public"."rating_source" AS ENUM('client', 'internal');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "placement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN IF NOT EXISTS "source" "rating_source" DEFAULT 'client' NOT NULL;