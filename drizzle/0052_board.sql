CREATE TYPE "public"."board_audience" AS ENUM('chefs', 'all');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_post_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"r2_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"audience" "board_audience" DEFAULT 'chefs' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_post_images" ADD CONSTRAINT "board_post_images_post_id_board_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."board_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_posts" ADD CONSTRAINT "board_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_reactions" ADD CONSTRAINT "board_reactions_post_id_board_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."board_posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_reactions" ADD CONSTRAINT "board_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_post_images_r2_key_unique" ON "board_post_images" USING btree ("r2_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_post_images_post_idx" ON "board_post_images" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_posts_feed_idx" ON "board_posts" USING btree ("pinned","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_reactions_unique" ON "board_reactions" USING btree ("post_id","user_id","emoji");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "board_reactions_post_idx" ON "board_reactions" USING btree ("post_id");