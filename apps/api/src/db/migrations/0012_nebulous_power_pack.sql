-- Capacidade do link do orçamento (mesmo desenho do convite, migration 0003).
--
-- O token de 32 bytes libera EXATAMENTE uma coisa: ler a linha daquele
-- orçamento, para a API descobrir de que oficina ele é. Todo o resto — itens,
-- fotos, decisão, estoque, timeline — roda depois com contexto normal de
-- oficina, resolvido a partir dessa linha.
--
-- Por que tão pouco: o link vai por WhatsApp e pode ser encaminhado. Ele prova
-- "alguém tem o endereço deste orçamento", não "alguém é da oficina". Policy
-- que não sustenta nada é passivo: quem ler isto depois vai assumir que sustenta.

CREATE OR REPLACE FUNCTION app_current_quote_token() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.quote_token', true), '')
$$;
--> statement-breakpoint

CREATE POLICY quote_by_token ON quotes FOR SELECT
  USING (public_token = (SELECT app_current_quote_token()));
