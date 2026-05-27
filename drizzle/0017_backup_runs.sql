CREATE TABLE IF NOT EXISTS "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"file_size" integer,
	"checksum" text,
	"encrypted_checksum" text,
	"location" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "restore_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_run_id" uuid,
	"restored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"target" text NOT NULL,
	"row_count_spot_check" integer,
	"result" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "restore_drills" ADD CONSTRAINT "restore_drills_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
