ALTER TABLE "client_submissions" ADD COLUMN "client_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_submissions" ADD CONSTRAINT "client_submissions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
