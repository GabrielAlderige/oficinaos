-- Ficha do carro (E31).
--
-- `catalog_vehicles` e `catalog_vehicle_specs` são da PLATAFORMA: não têm
-- organization_id, não entram no RLS de tenant, e toda oficina lê o mesmo —
-- como `plans`. Quem escreve é só administrador da plataforma, e isso é
-- decidido na API, não no banco.
--
-- A aplicação NÃO pode alterar o catálogo por engano: só leitura.
REVOKE INSERT, UPDATE, DELETE ON catalog_vehicles FROM PUBLIC;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON catalog_vehicle_specs FROM PUBLIC;
--> statement-breakpoint

-- O pedido "não achei meu carro" é dado da oficina — tem organization_id e
-- segue o isolamento de sempre.
SELECT app_enable_tenant_rls('catalog_vehicle_requests');
--> statement-breakpoint

-- ... mas a fila só serve se quem preenche enxergar TODAS as oficinas. Esta
-- política extra abre a leitura quando a API marca o contexto de plataforma,
-- do mesmo jeito que o orçamento público abre pelo token (D8). Sem a marca,
-- a oficina continua vendo só o que ela pediu.
CREATE POLICY platform_reads_requests ON catalog_vehicle_requests
  FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint

-- ano de pedido fora da faixa é digitação errada, e polui a fila
ALTER TABLE catalog_vehicle_requests ADD CONSTRAINT catalog_vehicle_requests_year_check
  CHECK (year IS NULL OR year BETWEEN 1950 AND 2100);
