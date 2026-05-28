ALTER TABLE "clients" ADD COLUMN "client_type" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "client_tags" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "favorite_chef_ids" text[];--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "blocked_chef_ids" text[];--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "dress_code" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "language_required" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "min_experience" integer;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "kitchen_type" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "solo_or_team" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "service_style" text;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "parking_available" boolean;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "meal_included" boolean;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "start_flexible" boolean;