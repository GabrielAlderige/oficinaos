CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"customer_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"work_order_id" uuid,
	"due_on" date NOT NULL,
	"reason" text,
	"dedupe_key" text NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "follow_ups_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "follow_ups_type_check" CHECK ("follow_ups"."type" in ('POST_SALE_7D','MAINTENANCE_DUE','NO_RETURN_6M')),
	CONSTRAINT "follow_ups_status_check" CHECK ("follow_ups"."status" in ('PENDING','DONE','SKIPPED')),
	CONSTRAINT "follow_ups_done_check" CHECK (("follow_ups"."status" = 'PENDING') = ("follow_ups"."done_at" is null))
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"stage" text DEFAULT 'NEW' NOT NULL,
	"source" text DEFAULT 'OTHER' NOT NULL,
	"vehicle_desc" text,
	"need" text,
	"estimated_value_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"lost_reason" text,
	"customer_id" uuid,
	"work_order_id" uuid,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "leads_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "leads_stage_check" CHECK ("leads"."stage" in ('NEW','CONTACTED','QUOTED','WAITING','WON','LOST')),
	CONSTRAINT "leads_source_check" CHECK ("leads"."source" in ('WALK_IN','PHONE','WHATSAPP','REFERRAL','SOCIAL','RETURNING','OTHER')),
	CONSTRAINT "leads_value_check" CHECK ("leads"."estimated_value_cents" >= 0),
	CONSTRAINT "leads_lost_check" CHECK ("leads"."stage" <> 'LOST' or "leads"."lost_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"rating" smallint,
	"comment" text,
	"submitted_at" timestamp with time zone,
	"invited_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"ip" text,
	"user_agent" text,
	"google_invited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "reviews_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" is null or "reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_submitted_check" CHECK (("reviews"."rating" is null) = ("reviews"."submitted_at" is null))
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_vehicle_fk" FOREIGN KEY ("organization_id","vehicle_id") REFERENCES "public"."vehicles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_dedupe_unique" ON "follow_ups" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "follow_ups_queue_idx" ON "follow_ups" USING btree ("organization_id","status","due_on");--> statement-breakpoint
CREATE INDEX "leads_stage_idx" ON "leads" USING btree ("organization_id","stage","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_name_idx" ON "leads" USING gin (immutable_unaccent(name) gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_work_order_unique" ON "reviews" USING btree ("organization_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_token_unique" ON "reviews" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "reviews_submitted_idx" ON "reviews" USING btree ("organization_id","submitted_at" DESC NULLS LAST);