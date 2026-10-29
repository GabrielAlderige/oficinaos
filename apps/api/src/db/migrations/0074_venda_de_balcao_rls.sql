-- Venda de balcão (E49): isolamento por oficina, como todo dado de tenant.
SELECT app_enable_tenant_rls('counter_sales');
--> statement-breakpoint
SELECT app_enable_tenant_rls('counter_sale_items');
--> statement-breakpoint

-- O que foi vendido não muda: a venda só pode ser cancelada (a linha da venda
-- ganha a situação e o motivo), e os itens ficam como prova do que saiu.
SELECT app_make_append_only('counter_sale_items');
--> statement-breakpoint

-- A coluna do livro-razão ganha a FK aqui (no schema do Drizzle ela faria um
-- import circular entre o catálogo e a venda), como a da compra na 0025.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_counter_sale_fk"
  FOREIGN KEY ("organization_id", "counter_sale_id") REFERENCES "counter_sales" ("organization_id", "id");
--> statement-breakpoint
-- movimento de venda de balcão sempre aponta para a venda
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_counter_sale_check"
  CHECK ("type" not in ('COUNTER_SALE_OUT', 'COUNTER_SALE_RETURN') or "counter_sale_id" is not null);
