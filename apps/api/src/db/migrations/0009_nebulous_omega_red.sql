-- Ordem de serviço: isolamento por oficina e timeline imutável.

-- 1) Isolamento por oficina (DATABASE.md §2). Toda tabela de tenant entra aqui,
--    senão o teste de guarda do RLS falha de propósito.
SELECT app_enable_tenant_rls('work_orders');
--> statement-breakpoint
SELECT app_enable_tenant_rls('work_order_items');
--> statement-breakpoint
SELECT app_enable_tenant_rls('work_order_events');
--> statement-breakpoint
SELECT app_enable_tenant_rls('vehicle_inspections');
--> statement-breakpoint
SELECT app_enable_tenant_rls('attachments');
--> statement-breakpoint

-- 2) A timeline conta o que aconteceu com o carro do cliente: evento não se
--    edita nem se apaga, como o livro-razão do estoque. Correção é evento novo.
SELECT app_make_append_only('work_order_events');
