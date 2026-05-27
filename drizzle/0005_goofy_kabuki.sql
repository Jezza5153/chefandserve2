CREATE TABLE IF NOT EXISTS "rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limits_updated_at_idx" ON "rate_limits" USING btree ("updated_at");