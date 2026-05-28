CREATE TABLE IF NOT EXISTS "shift_template_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"role_needed" "vakniveau" NOT NULL,
	"segment" "segment",
	"day_of_week" integer NOT NULL,
	"starts_at_time" time NOT NULL,
	"ends_at_time" time NOT NULL,
	"ends_next_day" boolean DEFAULT false NOT NULL,
	"headcount" integer DEFAULT 1 NOT NULL,
	"chef_rate_cents" integer,
	"client_rate_cents" integer,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"generate_horizon_days" integer DEFAULT 28 NOT NULL,
	"last_generated_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_templates_dow_check" CHECK ("shift_templates"."day_of_week" BETWEEN 0 AND 6)
);
--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "source_template_id" uuid;--> statement-breakpoint
ALTER TABLE "shifts" ADD COLUMN "source_template_date" date;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_template_exceptions" ADD CONSTRAINT "shift_template_exceptions_template_id_shift_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."shift_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_template_exceptions" ADD CONSTRAINT "shift_template_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_template_exceptions_unique" ON "shift_template_exceptions" USING btree ("template_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_templates_client_dow_role_unique" ON "shift_templates" USING btree ("client_id","day_of_week","starts_at_time","role_needed") WHERE "shift_templates"."active" = true;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_source_template_id_shift_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."shift_templates"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shifts_template_date_unique" ON "shifts" USING btree ("source_template_id","source_template_date") WHERE "shifts"."source_template_id" IS NOT NULL;