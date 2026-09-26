CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"last_preview" text,
	"last_direction" text,
	"unread" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "conversations_unread_check" CHECK ("conversations"."unread" >= 0)
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'NOT_SUBMITTED' NOT NULL,
	"provider_name" text,
	"automatic" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "message_templates_key_check" CHECK ("message_templates"."key" in ('QUOTE_SENT','VEHICLE_READY','APPOINTMENT_CONFIRM','CHARGE_LINK','REVIEW_INVITE','POST_SALE','MAINTENANCE_DUE','NO_RETURN')),
	CONSTRAINT "message_templates_status_check" CHECK ("message_templates"."status" in ('NOT_SUBMITTED','PENDING','APPROVED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "messaging_channels" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'LINK' NOT NULL,
	"status" text DEFAULT 'DISCONNECTED' NOT NULL,
	"phone_number_id" text,
	"waba_id" text,
	"display_phone" text,
	"access_token_enc" text,
	"app_secret_enc" text,
	"verify_token" text,
	"connected_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "messaging_channels_provider_check" CHECK ("messaging_channels"."provider" in ('LINK','CLOUD_API')),
	CONSTRAINT "messaging_channels_status_check" CHECK ("messaging_channels"."status" in ('DISCONNECTED','CONNECTED','ERROR'))
);
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_channel_check";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "failure_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "client_request_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_org_customer_unique" ON "conversations" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("organization_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_org_key_unique" ON "message_templates" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_channels_phone_unique" ON "messaging_channels" USING btree ("phone_number_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_id_unique" ON "messages" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_request_unique" ON "messages" USING btree ("organization_id","client_request_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_channel_check" CHECK ("messages"."channel" in ('WHATSAPP_LINK','WHATSAPP_API','EMAIL','PUBLIC_PAGE'));