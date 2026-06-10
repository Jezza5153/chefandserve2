ALTER TABLE "inbound_messages" ADD COLUMN "matched_user_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_matched_user_id_users_id_fk" FOREIGN KEY ("matched_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
