-- Automações (E21): isolamento por oficina, os avisos novos do sino e a
-- capacidade que deixa o trabalhador de fundo enxergar QUAIS oficinas existem.

SELECT app_enable_tenant_rls('automation_settings');
--> statement-breakpoint
SELECT app_enable_tenant_rls('automation_runs');
--> statement-breakpoint

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
--> statement-breakpoint
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type in ('QUOTE_VIEWED','QUOTE_APPROVED','QUOTE_PARTIALLY_APPROVED','QUOTE_REJECTED','QUOTE_QUESTION','SUPPLIER_QUOTE_ANSWERED','PURCHASE_RECEIVED','APPOINTMENT_TOMORROW','QUOTE_NO_ANSWER','FOLLOW_UP_DUE'));
--> statement-breakpoint

-- O trabalhador de fundo roda sem pessoa e sem oficina no contexto: ele
-- precisa descobrir a LISTA de oficinas para depois tratar cada uma com
-- contexto normal. A capacidade dá exatamente isso e nada mais — ler o id
-- das oficinas ativas. Todo o resto do trabalho continua passando pelo RLS
-- de sempre, oficina por oficina.
CREATE OR REPLACE FUNCTION app_is_job_runner() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT coalesce(nullif(current_setting('app.job_runner', true), ''), 'off') = 'on'
$$;
--> statement-breakpoint

CREATE POLICY organizations_for_jobs ON organizations FOR SELECT
  USING ((SELECT app_is_job_runner()));
