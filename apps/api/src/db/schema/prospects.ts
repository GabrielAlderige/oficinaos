import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { PROSPECT_SOURCES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';

/**
 * Interessados vindos da landing (E42).
 *
 * Tabela GLOBAL, sem RLS de tenant — como `plans` e `tutorial_lessons`. E tem
 * de ser: quem preenche o formulário do site **ainda não tem oficina**, então
 * não existe `organization_id` para amarrar. Por isso está registrada em
 * GLOBAL_TABLES no teste de guarda do RLS.
 *
 * Quem grava é o público (a landing), e a migration tira o UPDATE e o DELETE
 * da role da aplicação: o formulário só insere. Ler e marcar como contatado é
 * rota de administrador da plataforma.
 */
export const prospects = pgTable(
  'prospects',
  {
    id: id(),
    name: text().notNull(),
    /** só dígitos, com DDD: é assim que a planilha abre sem virar número quebrado */
    phone: text().notNull(),
    email: text().notNull().default(''),
    workshopName: text().notNull().default(''),
    message: text().notNull().default(''),
    source: text({ enum: PROSPECT_SOURCES }).notNull().default('LANDING'),
    /** quem já foi contatado sai da fila do remarketing */
    contactedAt: timestamptz(),
    notes: text().notNull().default(''),
    /** para reconhecer enxurrada do mesmo lugar; não aparece em tela nenhuma */
    ip: text(),
    userAgent: text(),
    ...timestamps,
  },
  (t) => [index('prospects_recentes_idx').on(t.createdAt), index('prospects_phone_idx').on(t.phone)],
);
