CREATE TYPE "public"."applying_as" AS ENUM('chef', 'front_of_house');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('payroll', 'zzp', 'both');--> statement-breakpoint
CREATE TYPE "public"."transport_mode" AS ENUM('car', 'motorbike', 'ebike', 'none');--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "house_number" text;--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "transport_mode" "transport_mode";--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "preferences" text[];--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "chef_submissions" ADD COLUMN "applying_as" "applying_as";--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "house_number" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "postcode" text;--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "transport_mode" "transport_mode";--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "preferences" text[];--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "chefs" ADD COLUMN "applying_as" "applying_as";