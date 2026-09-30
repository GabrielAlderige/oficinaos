-- Os planos passam a valer de verdade (E40).
--
-- O que estava errado antes desta migration:
--
--  1) A coluna `features` NUNCA era consultada para decidir nada. Era lida
--     para desenhar a tela de planos e mais nada. Quem pagava R$ 149 no Turbo
--     tinha exatamente o mesmo sistema de quem pagava R$ 499 no Nitro, menos
--     5 vagas de usuário — `maxUsers` era o único limite aplicado.
--
--  2) O Nitro vendia três coisas que não existem em linha nenhuma de código:
--     `multi_branch` (não há conceito de filial no schema), `custom_roles`
--     (ROLES é um array fixo de 6) e `public_api` (não há tabela de chave).
--     A tela pintava um ✓ verde do lado das três. Saem agora: o que não
--     existe não entra como incluído, vai para a lista de "em desenvolvimento"
--     que o painel mostra separada.
--
--  3) `suppliers` e `purchasing` continuam sem tela no painel (foram retiradas
--     na E23) e ficam para depois. Saem da lista de incluídos pelo mesmo
--     motivo: ninguém alcança, então ninguém pode estar pagando por elas.
--
-- O desenho novo (decidido com o dono em 29/09/2026):
--   TURBO         a oficina pequena trabalhando inteira, inclusive o financeiro
--   SUPERCHARGER  + entender a oficina: comissão, relatório, pacote
--   NITRO         + o sistema trabalhando sozinho: WhatsApp oficial,
--                 automações, e a pesquisa que cruza estoque com o carro da OS
--
-- A lista tem de bater com PLAN_FEATURE_MATRIX em
-- packages/shared/src/enums/plan-features.ts — `plan-features.test.ts` compara
-- as duas contra o banco, porque tela prometendo o que a API barra é pior do
-- que não prometer.

UPDATE plans SET
  limits = '{"maxUsers": 3, "maxWorkOrdersPerMonth": 150, "storageMb": 5120}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge',
                   'mobile_app', 'finance', 'delivery_proof']
WHERE code = 'TURBO';
--> statement-breakpoint

UPDATE plans SET
  limits = '{"maxUsers": 8, "maxWorkOrdersPerMonth": null, "storageMb": 25600}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge',
                   'mobile_app', 'finance', 'delivery_proof',
                   'commissions', 'service_packages', 'reports']
WHERE code = 'SUPERCHARGER';
--> statement-breakpoint

UPDATE plans SET
  limits = '{"maxUsers": null, "maxWorkOrdersPerMonth": null, "storageMb": 102400}',
  features = ARRAY['quotes', 'appointments', 'inventory', 'vehicle_specs', 'pix_charge',
                   'mobile_app', 'finance', 'delivery_proof',
                   'commissions', 'service_packages', 'reports',
                   'parts_search', 'whatsapp_api', 'automations']
WHERE code = 'NITRO';
