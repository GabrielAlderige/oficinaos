-- Pagamento: isolamento por oficina (DATABASE.md §2).
--
-- Diferente das provas do orçamento, `payments` NÃO é append-only: cancelar um
-- pagamento é um UPDATE legítimo (status, motivo, quem cancelou e quando). O
-- que o produto garante é que a linha nunca SOME — não existe DELETE no fluxo,
-- e o histórico do que foi recebido e estornado fica inteiro.
SELECT app_enable_tenant_rls('payments');
