ALTER TABLE "chefs" ADD COLUMN "intel" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "intel" jsonb;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "decline_reason" text;