-- Planos com nome de oficina (E38).
--
-- "Starter / Professional / Business" é nome de software americano; quem compra
-- é dono de oficina. Turbo, Supercharger e Nitro são três estágios de preparação
-- de motor, e a ordem é óbvia para quem trabalha com carro — ninguém precisa
-- perguntar qual é o maior.
--
-- Os preços saem da conta de custo real (docs/ARCHITECTURE.md, D71) e ficam
-- dentro da faixa praticada no Brasil: os sistemas baratos cobram R$ 79 a R$ 90,
-- os completos vão de R$ 189 a R$ 499. O anual é 10 meses pelo preço de 12.
--
-- Trocar o `code` é seguro: a coluna é TEXT com UNIQUE, sem CHECK, e a
-- assinatura aponta para o plano por `plan_id`, não pelo código.

UPDATE plans SET
  code = 'TURBO',
  name = 'Turbo',
  price_monthly_cents = 14900,
  price_yearly_cents = 149000,
  limits = '{"maxUsers": 3, "maxWorkOrdersPerMonth": 150, "storageMb": 5120}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app']
WHERE code = 'STARTER';
--> statement-breakpoint

UPDATE plans SET
  code = 'SUPERCHARGER',
  name = 'Supercharger',
  price_monthly_cents = 27900,
  price_yearly_cents = 279000,
  limits = '{"maxUsers": 8, "maxWorkOrdersPerMonth": null, "storageMb": 25600}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app',
                   'suppliers', 'purchasing', 'finance', 'reports', 'parts_search',
                   'commissions', 'service_packages', 'delivery_proof']
WHERE code = 'PROFESSIONAL';
--> statement-breakpoint

UPDATE plans SET
  code = 'NITRO',
  name = 'Nitro',
  price_monthly_cents = 49900,
  price_yearly_cents = 499000,
  limits = '{"maxUsers": null, "maxWorkOrdersPerMonth": null, "storageMb": 102400}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app',
                   'suppliers', 'purchasing', 'finance', 'reports', 'parts_search',
                   'commissions', 'service_packages', 'delivery_proof',
                   'automations', 'whatsapp_api', 'multi_branch', 'custom_roles', 'public_api']
WHERE code = 'BUSINESS';
--> statement-breakpoint

-- Banco novo (teste, CI) nasce direto com os três planos: o INSERT da 0003 roda
-- antes deste UPDATE, mas um banco recriado do zero também precisa dos planos
-- caso a 0003 tenha sido alterada no futuro.
INSERT INTO plans (id, code, name, price_monthly_cents, price_yearly_cents, limits, features) VALUES
  (gen_random_uuid(), 'TURBO', 'Turbo', 14900, 149000,
   '{"maxUsers": 3, "maxWorkOrdersPerMonth": 150, "storageMb": 5120}',
   ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app']),
  (gen_random_uuid(), 'SUPERCHARGER', 'Supercharger', 27900, 279000,
   '{"maxUsers": 8, "maxWorkOrdersPerMonth": null, "storageMb": 25600}',
   ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app',
         'suppliers', 'purchasing', 'finance', 'reports', 'parts_search',
         'commissions', 'service_packages', 'delivery_proof']),
  (gen_random_uuid(), 'NITRO', 'Nitro', 49900, 499000,
   '{"maxUsers": null, "maxWorkOrdersPerMonth": null, "storageMb": 102400}',
   ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge', 'mobile_app',
         'suppliers', 'purchasing', 'finance', 'reports', 'parts_search',
         'commissions', 'service_packages', 'delivery_proof',
         'automations', 'whatsapp_api', 'multi_branch', 'custom_roles', 'public_api'])
ON CONFLICT (code) DO NOTHING;
