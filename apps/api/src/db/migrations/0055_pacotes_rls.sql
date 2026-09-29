-- Pacotes de serviço (E27): catálogo da oficina, RLS de tenant como o resto
-- do catálogo.

SELECT app_enable_tenant_rls('service_packages');
--> statement-breakpoint
SELECT app_enable_tenant_rls('service_package_items');
