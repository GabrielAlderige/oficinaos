-- Agenda: isolamento por oficina (docs/DATABASE.md §2).
SELECT app_enable_tenant_rls('appointments');
--> statement-breakpoint

-- A ligação agendamento ↔ OS vale nos dois sentidos: `appointments.work_order_id`
-- sai do schema do Drizzle, e esta é a ponta de cá. Ela não é declarada em
-- `work-orders.ts` porque os dois arquivos passariam a se importar em círculo,
-- e tabela criada depois não pode ser referenciada por uma migration anterior.
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_appointment_fk
  FOREIGN KEY (organization_id, appointment_id)
  REFERENCES appointments (organization_id, id);
