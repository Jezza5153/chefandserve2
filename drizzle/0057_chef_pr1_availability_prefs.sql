ALTER TABLE "chefs" ADD COLUMN IF NOT EXISTS "travel_radius_km" integer;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN IF NOT EXISTS "available_for_emergency" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN IF NOT EXISTS "avoid_preferences" text[];--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN IF NOT EXISTS "min_start_hour" integer;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN IF NOT EXISTS "availability_notes" text;