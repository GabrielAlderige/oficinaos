CREATE TABLE "work_order_item_timers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"work_order_item_id" uuid NOT NULL,
	"mechanic_user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"minutes" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "work_order_item_timers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "work_order_item_timers_minutes_check" CHECK ("work_order_item_timers"."minutes" is null or "work_order_item_timers"."minutes" >= 0),
	CONSTRAINT "work_order_item_timers_stopped_check" CHECK (("work_order_item_timers"."stopped_at" is null) = ("work_order_item_timers"."minutes" is null) and ("work_order_item_timers"."stopped_at" is null or "work_order_item_timers"."stopped_at" >= "work_order_item_timers"."started_at"))
);
--> statement-breakpoint
ALTER TABLE "work_order_item_timers" ADD CONSTRAINT "work_order_item_timers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_item_timers" ADD CONSTRAINT "work_order_item_timers_mechanic_user_id_users_id_fk" FOREIGN KEY ("mechanic_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_item_timers" ADD CONSTRAINT "work_order_item_timers_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_order_item_timers" ADD CONSTRAINT "work_order_item_timers_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_order_item_timers_running_unique" ON "work_order_item_timers" USING btree ("organization_id","mechanic_user_id") WHERE stopped_at is null;--> statement-breakpoint
CREATE INDEX "work_order_item_timers_item_idx" ON "work_order_item_timers" USING btree ("organization_id","work_order_item_id","started_at");--> statement-breakpoint
CREATE INDEX "work_order_item_timers_mechanic_idx" ON "work_order_item_timers" USING btree ("organization_id","mechanic_user_id","started_at" DESC NULLS LAST);