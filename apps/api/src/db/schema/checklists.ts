import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { ChecklistItem } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

/**
 * Modelo de checklist da oficina (E49). Os itens ficam em `jsonb`, na ordem:
 * o modelo é lido inteiro e copiado inteiro para a inspeção — não há consulta
 * por item que justifique uma tabela.
 */
export const checklistTemplates = pgTable(
  'checklist_templates',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    items: jsonb().$type<ChecklistItem[]>().notNull(),
    /** o primeiro da lista é o que o check-in abre sugerido */
    position: integer().notNull().default(0),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('checklist_templates_org_id_unique').on(t.organizationId, t.id),
    index('checklist_templates_org_idx').on(t.organizationId, t.position),
    check('checklist_templates_items_check', sql`jsonb_typeof(${t.items}) = 'array' and jsonb_array_length(${t.items}) between 1 and 40`),
  ],
);
