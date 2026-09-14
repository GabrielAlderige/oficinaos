CREATE TABLE "part_price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"supplier_id" uuid,
	"price_cents" bigint NOT NULL,
	"source" text NOT NULL,
	"supplier_quote_request_id" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_price_history_source_check" CHECK ("part_price_history"."source" in ('RFQ','PURCHASE','PRICE_LIST','PROVIDER')),
	CONSTRAINT "part_price_history_price_check" CHECK ("part_price_history"."price_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"response_item_id" uuid NOT NULL,
	"awarded_by" uuid NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "supplier_quote_awards_requestItemId_unique" UNIQUE("request_item_id"),
	CONSTRAINT "supplier_quote_awards_org_id_unique" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"link_issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "supplier_quote_invites_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "supplier_quote_invites_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_quote_invites_request_supplier_unique" UNIQUE("request_id","supplier_id"),
	CONSTRAINT "supplier_quote_invites_token_hash_check" CHECK ("supplier_quote_invites"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_request_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"work_order_item_id" uuid,
	"part_id" uuid,
	"description" text NOT NULL,
	"part_code" text,
	"brand" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit" text DEFAULT 'UN' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_quote_request_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_quote_request_items_quantity_check" CHECK ("supplier_quote_request_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"work_order_id" uuid,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"vehicle" jsonb,
	"include_vin" boolean DEFAULT false NOT NULL,
	"message" text,
	"content_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "supplier_quote_requests_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_quote_requests_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "supplier_quote_requests_status_check" CHECK ("supplier_quote_requests"."status" in ('OPEN','CLOSED','CANCELED')),
	CONSTRAINT "supplier_quote_requests_hash_check" CHECK ("supplier_quote_requests"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "supplier_quote_requests_cancel_reason_check" CHECK ("supplier_quote_requests"."canceled_at" is null or "supplier_quote_requests"."cancel_reason" is not null),
	CONSTRAINT "supplier_quote_requests_canceled_consistency_check" CHECK ("supplier_quote_requests"."status" <> 'CANCELED' or "supplier_quote_requests"."canceled_at" is not null),
	CONSTRAINT "supplier_quote_requests_no_plate_check" CHECK ("supplier_quote_requests"."vehicle" is null or not ("supplier_quote_requests"."vehicle" ? 'plate')),
	CONSTRAINT "supplier_quote_requests_vin_check" CHECK ("supplier_quote_requests"."include_vin" or "supplier_quote_requests"."vehicle" is null or coalesce("supplier_quote_requests"."vehicle"->>'vin', '') = '')
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_response_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"request_item_id" uuid NOT NULL,
	"availability" text NOT NULL,
	"unit_price_cents" bigint,
	"brand" text,
	"lead_time_days" smallint,
	"notes" text,
	CONSTRAINT "supplier_quote_response_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_quote_response_items_response_item_unique" UNIQUE("response_id","request_item_id"),
	CONSTRAINT "supplier_quote_response_items_availability_check" CHECK ("supplier_quote_response_items"."availability" in ('AVAILABLE','TO_ORDER','UNAVAILABLE')),
	CONSTRAINT "supplier_quote_response_items_price_check" CHECK (("supplier_quote_response_items"."availability" = 'UNAVAILABLE' and "supplier_quote_response_items"."unit_price_cents" is null)
          or ("supplier_quote_response_items"."availability" <> 'UNAVAILABLE' and "supplier_quote_response_items"."unit_price_cents" > 0)),
	CONSTRAINT "supplier_quote_response_items_lead_time_check" CHECK ("supplier_quote_response_items"."lead_time_days" is null or "supplier_quote_response_items"."lead_time_days" between 0 and 365)
);
--> statement-breakpoint
CREATE TABLE "supplier_quote_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invite_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"responder_name" text NOT NULL,
	"shipping_cents" bigint,
	"notes" text,
	"content_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_quote_responses_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "supplier_quote_responses_invite_version_unique" UNIQUE("invite_id","version"),
	CONSTRAINT "supplier_quote_responses_version_check" CHECK ("supplier_quote_responses"."version" >= 1),
	CONSTRAINT "supplier_quote_responses_shipping_check" CHECK ("supplier_quote_responses"."shipping_cents" is null or "supplier_quote_responses"."shipping_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_order_events" DROP CONSTRAINT "work_order_events_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_request_fk" FOREIGN KEY ("organization_id","supplier_quote_request_id") REFERENCES "public"."supplier_quote_requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_awards" ADD CONSTRAINT "supplier_quote_awards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_awards" ADD CONSTRAINT "supplier_quote_awards_awarded_by_users_id_fk" FOREIGN KEY ("awarded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_awards" ADD CONSTRAINT "supplier_quote_awards_request_item_fk" FOREIGN KEY ("organization_id","request_item_id") REFERENCES "public"."supplier_quote_request_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_awards" ADD CONSTRAINT "supplier_quote_awards_response_item_fk" FOREIGN KEY ("organization_id","response_item_id") REFERENCES "public"."supplier_quote_response_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_invites" ADD CONSTRAINT "supplier_quote_invites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_invites" ADD CONSTRAINT "supplier_quote_invites_request_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."supplier_quote_requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_invites" ADD CONSTRAINT "supplier_quote_invites_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."suppliers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_request_items" ADD CONSTRAINT "supplier_quote_request_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_request_items" ADD CONSTRAINT "supplier_quote_request_items_request_fk" FOREIGN KEY ("organization_id","request_id") REFERENCES "public"."supplier_quote_requests"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_request_items" ADD CONSTRAINT "supplier_quote_request_items_work_order_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_request_items" ADD CONSTRAINT "supplier_quote_request_items_part_fk" FOREIGN KEY ("organization_id","part_id") REFERENCES "public"."parts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_requests" ADD CONSTRAINT "supplier_quote_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_requests" ADD CONSTRAINT "supplier_quote_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_requests" ADD CONSTRAINT "supplier_quote_requests_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_response_items" ADD CONSTRAINT "supplier_quote_response_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_response_items" ADD CONSTRAINT "supplier_quote_response_items_response_fk" FOREIGN KEY ("organization_id","response_id") REFERENCES "public"."supplier_quote_responses"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_response_items" ADD CONSTRAINT "supplier_quote_response_items_request_item_fk" FOREIGN KEY ("organization_id","request_item_id") REFERENCES "public"."supplier_quote_request_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_responses" ADD CONSTRAINT "supplier_quote_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_quote_responses" ADD CONSTRAINT "supplier_quote_responses_invite_fk" FOREIGN KEY ("organization_id","invite_id") REFERENCES "public"."supplier_quote_invites"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_price_history_part_idx" ON "part_price_history" USING btree ("organization_id","part_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "supplier_quote_request_items_request_idx" ON "supplier_quote_request_items" USING btree ("organization_id","request_id","position");--> statement-breakpoint
CREATE INDEX "supplier_quote_requests_work_order_idx" ON "supplier_quote_requests" USING btree ("organization_id","work_order_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "supplier_quote_requests_status_idx" ON "supplier_quote_requests" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "work_order_events" ADD CONSTRAINT "work_order_events_type_check" CHECK ("work_order_events"."type" in ('CREATED','STATUS_CHANGED','NOTE','ITEMS_CHANGED','CHECK_IN','CHECK_OUT','PHOTO_ADDED','QUOTE_SENT','QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_REJECTED','CUSTOMER_QUESTION','CUSTOMER_NOTIFIED','PAYMENT','DELIVERED','CANCELED','SUPPLIER_QUOTE_SENT','SUPPLIER_QUOTE_ANSWERED'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION','SUPPLIER_QUOTE_ANSWERED'));