ALTER TABLE "work_orders" ADD COLUMN "tracking_token" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_trackingToken_unique" UNIQUE("tracking_token");