-- Várias unidades (E50): a transferência de peça entre unidades. A saída numa
-- oficina e a entrada na outra carregam o mesmo transfer_id.

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_type_check";--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
CREATE INDEX "inventory_movements_transfer_idx" ON "inventory_movements" USING btree ("transfer_id") WHERE transfer_id is not null;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_transfer_check" CHECK ("inventory_movements"."type" not in ('TRANSFER_OUT', 'TRANSFER_IN') or "inventory_movements"."transfer_id" is not null);--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."type" in ('INITIAL','MANUAL_IN','ADJUSTMENT','WORK_ORDER_OUT','CUSTOMER_RETURN','PURCHASE_IN','SUPPLIER_RETURN','COUNTER_SALE_OUT','COUNTER_SALE_RETURN','TRANSFER_OUT','TRANSFER_IN'));