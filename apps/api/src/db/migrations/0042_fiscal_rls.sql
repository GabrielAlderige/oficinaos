-- Nota fiscal de serviço (E18): isolamento por oficina (docs/DATABASE.md §2).

SELECT app_enable_tenant_rls('organization_fiscal_settings');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invoices');
--> statement-breakpoint
SELECT app_enable_tenant_rls('invoice_items');
--> statement-breakpoint

-- A nota é cópia congelada do que foi para a prefeitura: se o item sair da OS
-- depois, o ponteiro cai e a nota continua inteira (mesma regra da D36).
ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_work_order_item_fk;
--> statement-breakpoint
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_work_order_item_fk
  FOREIGN KEY (organization_id, work_order_item_id)
  REFERENCES work_order_items (organization_id, id)
  ON DELETE SET NULL (work_order_item_id);
