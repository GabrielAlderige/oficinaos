-- Nota de peças (E50): isolamento por oficina. Os itens são cópia congelada do
-- que foi para a SEFAZ: não mudam depois de gravados.
SELECT app_enable_tenant_rls('product_invoices');
--> statement-breakpoint
SELECT app_enable_tenant_rls('product_invoice_items');
--> statement-breakpoint
SELECT app_make_append_only('product_invoice_items');
