-- Compras: isolamento por oficina (docs/DATABASE.md §2).
SELECT app_enable_tenant_rls('purchase_orders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_order_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_receipts');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_receipt_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_returns');
--> statement-breakpoint
SELECT app_enable_tenant_rls('purchase_return_items');
--> statement-breakpoint

-- Recebimento e devolução são PROVA do que entrou e saiu do estoque, com que
-- nota e por quem. A aplicação não altera nem apaga: errou o recebimento,
-- devolve ao fornecedor (decisão de 14/09/2026). O pedido e as linhas não são
-- append-only: rascunho se edita e a situação muda.
SELECT app_make_append_only('purchase_receipts');
--> statement-breakpoint
SELECT app_make_append_only('purchase_receipt_items');
--> statement-breakpoint
SELECT app_make_append_only('purchase_returns');
--> statement-breakpoint
SELECT app_make_append_only('purchase_return_items');
--> statement-breakpoint

-- As colunas que já esperavam a E12 ganham FK agora (no schema do Drizzle elas
-- ficariam num import circular entre catálogo, cotação e compras).
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchase_order_fk"
  FOREIGN KEY ("organization_id", "purchase_order_id") REFERENCES "purchase_orders" ("organization_id", "id");
--> statement-breakpoint
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_purchase_order_fk"
  FOREIGN KEY ("organization_id", "purchase_order_id") REFERENCES "purchase_orders" ("organization_id", "id");
--> statement-breakpoint
-- histórico de preço de compra aponta para a compra; de cotação, para a cotação
ALTER TABLE "part_price_history" ADD CONSTRAINT "part_price_history_origin_check"
  CHECK (("source" <> 'PURCHASE' or "purchase_order_id" is not null) and ("source" <> 'RFQ' or "supplier_quote_request_id" is not null));
