CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ran_on" text NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "automation_runs_key_check" CHECK ("automation_runs"."key" in ('FOLLOW_UP_QUEUE','APPOINTMENT_REMINDER','QUOTE_NO_ANSWER','DAILY_DIGEST'))
);
--> statement-breakpoint
CREATE TABLE "automation_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"follow_up_queue" boolean DEFAULT true NOT NULL,
	"appointment_reminder" boolean DEFAULT true NOT NULL,
	"quote_no_answer" boolean DEFAULT true NOT NULL,
	"daily_digest" boolean DEFAULT false NOT NULL,
	"run_hour" integer DEFAULT 8 NOT NULL,
	"quote_no_answer_days" integer DEFAULT 3 NOT NULL,
	"digest_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "automation_run_hour_check" CHECK ("automation_settings"."run_hour" between 0 and 23),
	CONSTRAINT "automation_no_answer_days_check" CHECK ("automation_settings"."quote_no_answer_days" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_runs_org_idx" ON "automation_runs" USING btree ("organization_id","key","ran_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION','SUPPLIER_QUOTE_ANSWERED','PURCHASE_RECEIVED','APPOINTMENT_TOMORROW','QUOTE_NO_ANSWER','FOLLOW_UP_DUE'));