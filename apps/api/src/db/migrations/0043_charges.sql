CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"work_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"environment" text NOT NULL,
	"provider" text NOT NULL,
	"client_request_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_date" date NOT NULL,
	"description" text NOT NULL,
	"provider_charge_id" text,
	"provider_customer_id" text,
	"payment_url" text,
	"pix_payload" text,
	"pix_qr_image" text,
	"boleto_url" text,
	"barcode" text,
	"payment_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_amount_cents" bigint,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"canceled_by" uuid,
	"refunded_at" timestamp with time zone,
	"failure_reason" text,
	"provider_response" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "charges_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "charges_method_check" CHECK ("charges"."method" in ('PIX','BOLETO','CREDIT_CARD','LINK')),
	CONSTRAINT "charges_status_check" CHECK ("charges"."status" in ('PENDING','PAID','CANCELED','EXPIRED','REFUNDED','FAILED')),
	CONSTRAINT "charges_environment_check" CHECK ("charges"."environment" in ('SIMULATOR','SANDBOX','PRODUCTION')),
	CONSTRAINT "charges_amount_check" CHECK ("charges"."amount_cents" > 0),
	CONSTRAINT "charges_canceled_check" CHECK (("charges"."status" = 'CANCELED') = ("charges"."canceled_at" is not null) and ("charges"."canceled_at" is null or "charges"."cancel_reason" is not null)),
	CONSTRAINT "charges_paid_check" CHECK ("charges"."status" <> 'PAID' or ("charges"."paid_at" is not null and "charges"."payment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"event_type" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_canceled_by_users_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_work_order_fk" FOREIGN KEY ("organization_id","work_order_id") REFERENCES "public"."work_orders"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_customer_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charges_client_request_unique" ON "charges" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_provider_charge_unique" ON "charges" USING btree ("provider","provider_charge_id");--> statement-breakpoint
CREATE INDEX "charges_org_created_idx" ON "charges" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "charges_work_order_idx" ON "charges" USING btree ("organization_id","work_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_unique" ON "payment_webhook_events" USING btree ("provider","external_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_unique" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."payments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint