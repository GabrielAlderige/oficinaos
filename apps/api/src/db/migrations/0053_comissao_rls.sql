-- Comissão do mecânico (E26): o fechamento é dado da oficina como qualquer
-- outro, então entra no RLS de tenant de sempre. O cálculo da comissão não
-- tem tabela: ele sai do que o cliente pagou com o percentual congelado no
-- item da OS.

SELECT app_enable_tenant_rls('commission_payouts');
--> statement-breakpoint

-- valor pago em comissão é sempre positivo, e o período tem começo e fim na
-- ordem certa: fechamento com data invertida vira relatório que não fecha
ALTER TABLE commission_payouts ADD CONSTRAINT commission_payouts_amount_check
  CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE commission_payouts ADD CONSTRAINT commission_payouts_period_check
  CHECK (period_from <= period_to);
