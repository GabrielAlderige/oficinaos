-- WhatsApp oficial (E22): o canal da oficina, os modelos e a conversa.

SELECT app_enable_tenant_rls('messaging_channels');
--> statement-breakpoint
SELECT app_enable_tenant_rls('message_templates');
--> statement-breakpoint
SELECT app_enable_tenant_rls('conversations');
--> statement-breakpoint

ALTER TABLE messages DROP CONSTRAINT messages_channel_check;
--> statement-breakpoint
ALTER TABLE messages ADD CONSTRAINT messages_channel_check
  CHECK (channel in ('WHATSAPP_LINK','WHATSAPP_API','EMAIL','PUBLIC_PAGE'));
--> statement-breakpoint

-- O aviso da Meta chega SEM oficina: quem diz de quem é a conversa é o id do
-- número no WhatsApp. Mesmo desenho do link do orçamento (0012), da cobrança
-- (0044) e da assinatura (0047): quem apresenta a referência lê EXATAMENTE
-- aquela linha, e o resto do trabalho roda com contexto normal de oficina.
CREATE OR REPLACE FUNCTION app_current_phone_ref() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.phone_number_ref', true), '')
$$;
--> statement-breakpoint

CREATE POLICY channel_by_phone_ref ON messaging_channels FOR SELECT
  USING (phone_number_id IS NOT NULL AND phone_number_id = (SELECT app_current_phone_ref()));
