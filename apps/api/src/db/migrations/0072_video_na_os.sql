-- Vídeo na OS (E45, 25/10/2026): o vídeo chega no formato do aparelho, é
-- convertido no servidor (PROCESSING) e é apagado 7 dias depois da resposta
-- do cliente (EXPIRED). A linha fica; o arquivo, não.

ALTER TABLE "attachments" DROP CONSTRAINT "attachments_status_check";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "poster_storage_key" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "attachments_videos_alive_idx" ON "attachments" USING btree ("organization_id","expires_at") WHERE "attachments"."kind" = 'VIDEO' and "attachments"."status" in ('PENDING_UPLOAD', 'PROCESSING', 'READY');--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_status_check" CHECK ("attachments"."status" in ('PENDING_UPLOAD','PROCESSING','READY','FAILED','EXPIRED'));--> statement-breakpoint

-- Supercharger e Nitro ganham o vídeo (packages/shared/src/enums/plan-features.ts;
-- o plan-features.test.ts compara as duas listas).
UPDATE plans SET features = array_append(features, 'work_order_video')
  WHERE code IN ('SUPERCHARGER', 'NITRO') AND NOT ('work_order_video' = ANY (features));
