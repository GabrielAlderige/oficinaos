-- Avisos de atraso da assinatura (vai travar, travou). Diferente dos e-mails
-- do teste, atraso pode acontecer mais de uma vez: o tipo leva a data em que a
-- carência começou ('TRAVA_EM_2_DIAS:2026-11-05'), e o índice único
-- (oficina, tipo) continua garantindo um envio por atraso.

ALTER TABLE "lifecycle_emails" DROP CONSTRAINT "lifecycle_emails_kind_check";
--> statement-breakpoint
ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_kind_check"
	CHECK (
		kind IN ('BOAS_VINDAS', 'METADE_DO_TESTE', 'FALTAM_3_DIAS', 'ULTIMO_DIA', 'TESTE_ACABOU')
		OR kind ~ '^(PAGAMENTO_PENDENTE|TRAVA_EM_2_DIAS|SISTEMA_TRAVADO):\d{4}-\d{2}-\d{2}$'
	);
