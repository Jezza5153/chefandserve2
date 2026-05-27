CREATE TYPE "public"."recovery_intent" AS ENUM('password', 'totp');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recovery_intents" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"intent" "recovery_intent" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recovery_intents" ADD CONSTRAINT "recovery_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recovery_intents_user_idx" ON "recovery_intents" USING btree ("user_id","intent");