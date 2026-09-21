-- Assinatura do SaaS (E20): o histórico de pagamento é da oficina, e só ela vê.
SELECT app_enable_tenant_rls('subscription_payments');
