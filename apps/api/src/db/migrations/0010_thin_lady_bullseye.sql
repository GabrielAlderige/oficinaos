CREATE TABLE "quote_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"channel" text NOT NULL,
	"approved_quote_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"approved_total_cents" bigint DEFAULT 0 NOT NULL,
	"signer_name" text,
	"rejection_reason" text,
	"ip" text,
	"user_agent" text,
	"content_hash" text NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_approvals_quoteId_unique" UNIQUE("quote_id"),
	CONSTRAINT "quote_approvals_decision_check" CHECK ("quote_approvals"."decision" in ('APPROVED','PARTIALLY_APPROVED','REJECTED')),
	CONSTRAINT "quote_approvals_channel_check" CHECK ("quote_approvals"."channel" in ('PUBLIC_LINK','PHONE','IN_PERSON','WHATSAPP')),
	CONSTRAINT "quote_approvals_proof_check" CHECK (("quote_approvals"."channel" = 'PUBLIC_LINK' and "quote_approvals"."signer_name" is not null) or ("quote_approvals"."channel" <> 'PUBLIC_LINK' and "quote_approvals"."recorded_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "quote_attachments" (
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"quote_item_id" uuid,
	"caption" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "quote_attachments_quote_id_attachment_id_pk" PRIMARY KEY("quote_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"work_order_item_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"part_code" text,
	"brand" text,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quote_items_type_check" CHECK ("quote_items"."type" in ('SERVICE','PART')),
	CONSTRAINT "quote_items_quantity_check" CHECK ("quote_items"."quantity" > 0),
	CONSTRAINT "quote_items_money_check" CHECK ("quote_items"."unit_price_cents" >= 0 and "quote_items"."total_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"work_order_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'INITIAL' NOT NULL,
	"status" text DEFAULT 'SENT' NOT NULL,
	"public_token" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"discount_cents" bigint DEFAULT 0 NOT NULL,
	"surcharge_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_by" uuid,
	"sent_channel" text,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"decided_at" timestamp with time zone,
	"superseded_by_quote_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "quotes_publicToken_unique" UNIQUE("public_token"),
	CONSTRAINT "quotes_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "quotes_org_number_unique" UNIQUE("organization_id","number"),
	CONSTRAINT "quotes_status_check" CHECK ("quotes"."status" in ('SENT','APPROVED','PARTIALLY_APPROVED','REJECTED','EXPIRED','SUPERSEDED','REVOKED')),
	CONSTRAINT "quotes_kind_check" CHECK ("quotes"."kind" in ('INITIAL','SUPPLEMENTARY')),
	CONSTRAINT "quotes_number_check" CHECK ("quotes"."number" > 0),
	CONSTRAINT "quotes_money_check" CHECK ("quotes"."total_cents" >= 0 and "quotes"."discount_cents" >= 0),
	CONSTRAINT "quotes_view_count_check" CHECK ("quotes"."view_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid,
	"channel" text NOT NULL,
	"direction" text DEFAULT 'OUTBOUND' NOT NULL,
	"template_key" text,
	"body" text NOT NULL,
	"to_address" text,
	"work_order_id" uuid,
	"quote_id" uuid,
	"status" text NOT NULL,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('WHATSAPP_LINK','EMAIL','PUBLIC_PAGE')),
	CONSTRAINT "messages_direction_check" CHECK ("messages"."direction" in ('OUTBOUND','INBOUND')),
	CONSTRAINT "messages_status_check" CHECK ("messages"."status" in ('LINK_OPENED','SENT','DELIVERED','READ','FAILED','RECEIVED'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"work_order_id" uuid,
	"quote_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION'))
);
--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_approvals" ADD CONSTRAINT "quote_approvals_quote_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_quote_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_attachment_fk" FOREIGN KEY ("organization_id","attachment_id") REFERENCES "public"."attachments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_attachments" ADD CONSTRAINT "quote_attachments_item_fk" FOREIGN KEY ("organization_id","quote_item_id") REFERENCES "public"."quote_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_fk" FOREIGN KEY ("organization_id","quote_id") REFERENCES "public"."quotes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_work_order_item_fk" FOREIGN KEY ("organization_id","work_order_item_id") REFERENCES "public"."work_order_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_items_quote_idx" ON "quote_items" USING btree ("organization_id","quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_one_open_per_work_order" ON "quotes" USING btree ("organization_id","work_order_id") WHERE status = 'SENT';--> statement-breakpoint
CREATE INDEX "quotes_org_status_idx" ON "quotes" USING btree ("organization_id","status","sent_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_org_created_idx" ON "messages" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_customer_idx" ON "messages" USING btree ("organization_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("organization_id","user_id","read_at","created_at" DESC NULLS LAST);