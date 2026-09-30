-- A plataforma enxerga as oficinas para poder operar o SaaS (E41).
--
-- O problema que isto resolve: não existia NENHUMA forma de estender o teste
-- de uma oficina sem abrir o Postgres de produção e escrever SQL na mão. Para
-- um piloto com preço de fundador — que precisa de 60 ou 90 dias em vez de 14 —
-- isso significava conectar no banco vivo, sem trilha de auditoria, com todo o
-- risco que isso tem.
--
-- Segue o mesmo desenho da fila da ficha do carro (0059): a tabela continua
-- com RLS forçado por oficina, e uma política EXTRA abre a leitura só quando a
-- API marca o contexto de plataforma (`app.platform_admin = on`), que por sua
-- vez só é marcado em rota com `auth: 'platform-admin'`. Sem a marca, nada
-- muda para ninguém — a oficina continua enxergando só o que é dela.
--
-- A escrita NÃO é aberta por política: quem grava é a API, dentro de uma rota
-- de plataforma, registrando na trilha de auditoria quem estendeu e por quê.
-- Política de UPDATE aberta seria uma porta permanente; o que a gente quer é
-- uma porta com registro.

CREATE POLICY platform_reads_organizations ON organizations
  FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint

CREATE POLICY platform_reads_subscriptions ON subscriptions
  FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint

-- estender o teste é a única escrita que a plataforma faz aqui, e ela passa
-- por esta política: `app.platform_admin` ligado E a coluna que muda é o fim
-- do teste (garantido pela API, que só monta este UPDATE)
CREATE POLICY platform_extends_trial ON subscriptions
  FOR UPDATE
  USING (current_setting('app.platform_admin', true) = 'on')
  WITH CHECK (current_setting('app.platform_admin', true) = 'on');
--> statement-breakpoint

CREATE POLICY platform_reads_memberships ON memberships
  FOR SELECT
  USING (current_setting('app.platform_admin', true) = 'on');
