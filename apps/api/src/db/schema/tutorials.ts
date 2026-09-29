import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { TUTORIAL_MODULES, TUTORIAL_PLAYERS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Tutoriais em vídeo (E39) — conteúdo da PLATAFORMA.
 *
 * Tabela GLOBAL, sem RLS de tenant, como `catalog_vehicles` e `plans`: a aula
 * não é de nenhuma oficina, todas veem a mesma. Por isso está registrada em
 * GLOBAL_TABLES no teste de guarda do RLS. Quem escreve é só administrador da
 * plataforma, e isso é decidido na API.
 */
export const tutorialLessons = pgTable(
  'tutorial_lessons',
  {
    id: id(),
    module: text({ enum: TUTORIAL_MODULES }).notNull(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    description: text().notNull().default(''),
    player: text({ enum: TUTORIAL_PLAYERS }).notNull().default('YOUTUBE'),
    /** nulo enquanto o vídeo não foi gravado: a aula fica rascunho */
    videoUrl: text(),
    durationSeconds: integer(),
    position: integer().notNull().default(0),
    /** rascunho não aparece para a oficina */
    publishedAt: timestamptz(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('tutorial_lessons_order_idx').on(t.module, t.position),
    check('tutorial_lessons_module_check', sql`${t.module} in (${list(TUTORIAL_MODULES)})`),
    check('tutorial_lessons_player_check', sql`${t.player} in (${list(TUTORIAL_PLAYERS)})`),
    // publicar sem vídeo colocaria a oficina diante de uma tela preta
    check('tutorial_lessons_published_has_video', sql`${t.publishedAt} is null or ${t.videoUrl} is not null`),
  ],
);

/**
 * Quem já assistiu o quê. Isto SIM é dado da oficina — tem `organization_id` e
 * segue o isolamento de sempre. A marca é por PESSOA: o dono ter visto a aula
 * não faz o mecânico ter visto.
 */
export const tutorialViews = pgTable(
  'tutorial_views',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    lessonId: uuid()
      .notNull()
      .references(() => tutorialLessons.id, { onDelete: 'cascade' }),
    watchedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('tutorial_views_once').on(t.userId, t.lessonId),
    index('tutorial_views_org_idx').on(t.organizationId, t.userId),
  ],
);
