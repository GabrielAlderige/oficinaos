CREATE TABLE "tutorial_lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"module" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"player" text DEFAULT 'YOUTUBE' NOT NULL,
	"video_url" text,
	"duration_seconds" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "tutorial_lessons_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tutorial_lessons_module_check" CHECK ("tutorial_lessons"."module" in ('PRIMEIROS_PASSOS', 'CLIENTES', 'AGENDA', 'ORDEM_DE_SERVICO', 'ORCAMENTO', 'PECAS', 'DINHEIRO', 'FICHA_DO_CARRO', 'PAINEL', 'POS_VENDA', 'WHATSAPP', 'CELULAR', 'CONFIGURACOES')),
	CONSTRAINT "tutorial_lessons_player_check" CHECK ("tutorial_lessons"."player" in ('YOUTUBE', 'VIMEO', 'ARQUIVO')),
	CONSTRAINT "tutorial_lessons_published_has_video" CHECK ("tutorial_lessons"."published_at" is null or "tutorial_lessons"."video_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "tutorial_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutorial_views_once" UNIQUE("user_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "tutorial_lessons" ADD CONSTRAINT "tutorial_lessons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_views" ADD CONSTRAINT "tutorial_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_views" ADD CONSTRAINT "tutorial_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutorial_views" ADD CONSTRAINT "tutorial_views_lesson_id_tutorial_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."tutorial_lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tutorial_lessons_order_idx" ON "tutorial_lessons" USING btree ("module","position");--> statement-breakpoint
CREATE INDEX "tutorial_views_org_idx" ON "tutorial_views" USING btree ("organization_id","user_id");
