-- Interessados vindos da landing (E42).
--
-- Tabela GLOBAL, sem RLS por oficina — e tem de ser: quem preenche o
-- formulário do site **ainda não tem oficina**, então não existe
-- `organization_id` para amarrar. Fica registrada em GLOBAL_TABLES no teste de
-- guarda do RLS, junto com `plans`, `catalog_vehicles` e `tutorial_lessons`.
--
-- O formulário é PÚBLICO: qualquer um na internet chama a rota que insere
-- aqui. Por isso a role da aplicação recebe INSERT e SELECT, mas **não**
-- UPDATE nem DELETE. Assim, mesmo que alguém encontre um jeito de abusar da
-- rota pública, o pior que consegue é sujar a lista — nunca apagar os
-- interessados que já entraram, que são o ativo comercial desta tabela.
--
-- Marcar como contatado é UPDATE, e roda pela role DONA em rota de
-- administrador da plataforma (§ platform.service).

CREATE TABLE prospects (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"workshop_name" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'LANDING' NOT NULL,
	"contacted_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE prospects ADD CONSTRAINT prospects_source_check
	CHECK (source IN ('LANDING', 'WHATSAPP', 'INDICACAO', 'OUTRO'));
--> statement-breakpoint

-- a lista abre pelos mais recentes; o telefone é como se acha alguém que voltou
CREATE INDEX prospects_recentes_idx ON prospects ("created_at");
--> statement-breakpoint
CREATE INDEX prospects_phone_idx ON prospects ("phone");
--> statement-breakpoint

-- Apagar interessado não é operação de rota nenhuma.
--
-- `REVOKE ... FROM PUBLIC` NÃO resolveria aqui: o `db-setup` concede
-- SELECT/INSERT/UPDATE/DELETE à role da aplicação por ALTER DEFAULT
-- PRIVILEGES, ou seja, um grant EXPLÍCITO — e revogar do PUBLIC não toca em
-- grant explícito. É preciso revogar de cada role concedida, que é o que o
-- `app_make_append_only` (0001) faz. Aqui é a mesma técnica, só que tirando
-- apenas o DELETE: o UPDATE fica, porque "marcar como contatado" roda pela
-- role da aplicação.
DO $$
DECLARE
  grantee_role text;
BEGIN
  FOR grantee_role IN
    SELECT DISTINCT g.grantee
    FROM information_schema.role_table_grants g
    WHERE g.table_schema = 'public'
      AND g.table_name = 'prospects'
      AND g.privilege_type IN ('DELETE', 'TRUNCATE')
      AND g.grantee <> current_user
  LOOP
    EXECUTE format('REVOKE DELETE, TRUNCATE ON prospects FROM %I', grantee_role);
  END LOOP;
END
$$;
