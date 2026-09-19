-- "Acompanhe seu veículo" (E17): a capacidade do link, com o mesmo desenho do
-- orçamento (migration 0012) e da avaliação (0035).
--
-- O token libera EXATAMENTE uma coisa: ler a linha daquela OS, para a API
-- descobrir de que oficina ela é. O resto — veículo, timeline, totais — roda
-- depois com contexto normal de oficina, e a página só mostra o que o cliente
-- já sabe: em que pé está o carro dele.
CREATE OR REPLACE FUNCTION app_current_tracking_token() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tracking_token', true), '')
$$;
--> statement-breakpoint

CREATE POLICY work_order_by_tracking_token ON work_orders FOR SELECT
  USING (tracking_token = (SELECT app_current_tracking_token()));
