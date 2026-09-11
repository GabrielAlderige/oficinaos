-- Clientes, veículos e leituras de km: isolamento por oficina (DATABASE.md §2).
-- Nenhuma leitura ampliada aqui: sem oficina no contexto, nada é visível.
SELECT app_enable_tenant_rls('customers');
--> statement-breakpoint
SELECT app_enable_tenant_rls('vehicles');
--> statement-breakpoint
SELECT app_enable_tenant_rls('odometer_readings');
