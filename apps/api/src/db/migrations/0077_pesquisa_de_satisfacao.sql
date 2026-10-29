-- Pesquisa de satisfação (E49): a nota passa a ser a do NPS, de 0 a 10 (a de 1
-- a 5 da E16 nunca chegou a ter resposta em produção), e o sino ganha o aviso
-- de cliente insatisfeito.

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_rating_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION','SUPPLIER_QUOTE_ANSWERED','PURCHASE_RECEIVED','APPOINTMENT_TOMORROW','QUOTE_NO_ANSWER','FOLLOW_UP_DUE','SATISFACTION_LOW'));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("reviews"."rating" is null or "reviews"."rating" between 0 and 10);