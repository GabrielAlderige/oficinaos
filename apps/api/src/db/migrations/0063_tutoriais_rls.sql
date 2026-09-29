-- Tutoriais em vídeo (E39).
--
-- `tutorial_lessons` é da PLATAFORMA: não tem organization_id, não entra no
-- RLS de tenant, e toda oficina lê a mesma aula — como `plans` e
-- `catalog_vehicles`. Quem escreve é só administrador da plataforma, e isso é
-- decidido na API, não no banco. A aplicação só lê.
REVOKE INSERT, UPDATE, DELETE ON tutorial_lessons FROM PUBLIC;
--> statement-breakpoint

-- O progresso É da oficina: quem assistiu o quê é dado dela, e segue o
-- isolamento de sempre.
SELECT app_enable_tenant_rls('tutorial_views');
