-- Auth e assinatura: isolamento das tabelas novas + policies SÓ DE LEITURA
-- para os casos em que ainda não existe oficina no contexto.
--
-- Por que não SECURITY DEFINER (como a Fase 0 previa): o RLS é FORCE, vale até
-- para a dona das tabelas. Uma função SECURITY DEFINER da dona também não
-- enxergaria nada sem contexto, e criar uma role com BYPASSRLS só para isso
-- abriria justamente a porta que o desenho fecha. Policies FOR SELECT ampliam a
-- LEITURA de forma controlada e nunca permitem escrever fora da oficina do
-- contexto (INSERT/UPDATE/DELETE continuam presos à policy tenant_isolation).

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

SELECT app_enable_tenant_rls('invitations');
--> statement-breakpoint
SELECT app_enable_tenant_rls('subscriptions');
--> statement-breakpoint
SELECT app_enable_tenant_rls('organization_counters');
--> statement-breakpoint
SELECT app_enable_tenant_rls('usage_counters');
--> statement-breakpoint

-- Login e seletor de oficina: o usuário enxerga os PRÓPRIOS vínculos, em qualquer oficina.
CREATE POLICY own_memberships ON memberships FOR SELECT
  USING (user_id = (SELECT app_current_user()));
--> statement-breakpoint

-- ...e o nome das oficinas das quais participa.
CREATE POLICY member_organizations ON organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id = (SELECT app_current_user())
  ));
--> statement-breakpoint

-- Aceite de convite (página pública): quem apresenta o hash do token lê AQUELE convite.
-- O token é a capacidade; sem ele, nada é visível.
CREATE POLICY invitation_by_token ON invitations FOR SELECT
  USING (token_hash = nullif(current_setting('app.invite_token_hash', true), ''));
--> statement-breakpoint

-- Planos (dado de referência; valores são hipótese comercial, ver docs/ROADMAP.md)
INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, features) VALUES
  (gen_random_uuid(), 'STARTER', 'Starter', 9900, NULL,
   '{"maxUsers": 3, "maxWorkOrdersPerMonth": 150, "storageMb": 5120}',
   ARRAY['quotes', 'appointments', 'inventory']),
  (gen_random_uuid(), 'PROFESSIONAL', 'Professional', 19900, NULL,
   '{"maxUsers": 8, "maxWorkOrdersPerMonth": null, "storageMb": 25600}',
   ARRAY['quotes', 'appointments', 'inventory', 'suppliers', 'purchasing', 'finance', 'reports', 'parts_search']),
  (gen_random_uuid(), 'BUSINESS', 'Business', 39900, NULL,
   '{"maxUsers": null, "maxWorkOrdersPerMonth": null, "storageMb": 102400}',
   ARRAY['quotes', 'appointments', 'inventory', 'suppliers', 'purchasing', 'finance', 'reports', 'parts_search',
         'automations', 'whatsapp_api', 'multi_branch', 'custom_roles', 'public_api'])
ON CONFLICT (code) DO NOTHING;
