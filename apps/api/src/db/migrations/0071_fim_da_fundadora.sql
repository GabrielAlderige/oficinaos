-- Aviso do fim do preço de fundadora (D92): 30 dias antes de a mensalidade
-- subir para a tabela. O tipo leva a data em que o preço acaba
-- ('FUNDADORA_FIM:2028-02-04'), como os avisos de atraso.

ALTER TABLE "lifecycle_emails" DROP CONSTRAINT "lifecycle_emails_kind_check";
--> statement-breakpoint
ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_kind_check"
	CHECK (
		kind IN ('BOAS_VINDAS', 'METADE_DO_TESTE', 'FALTAM_3_DIAS', 'ULTIMO_DIA', 'TESTE_ACABOU')
		OR kind ~ '^(PAGAMENTO_PENDENTE|TRAVA_EM_2_DIAS|SISTEMA_TRAVADO|FUNDADORA_FIM):\d{4}-\d{2}-\d{2}$'
	);
