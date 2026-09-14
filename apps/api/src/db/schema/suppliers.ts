import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext, id, timestamps, timestamptz } from './_columns';
import { type Address, organizations, users } from './tenancy';

/**
 * Fornecedor da oficina (docs/DATABASE.md §6, MVP 2). Base da cadeia da peça:
 * a cotação por link (E11) e a compra (E12) apontam para cá.
 *
 * `categories` é `text[]` de rótulos livres, com índice GIN: a E11 vai sugerir
 * "quem vende freio" com `categories @> array['Freios']`, sem tabela de ligação.
 *
 * Fornecedor nunca some de verdade (`deleted_at`): a compra do ano passado tem
 * de continuar dizendo de quem foi.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    legalName: text(),
    /** CNPJ normalizado (maiúsculas, sem pontuação; aceita o alfanumérico) */
    document: text(),
    contactName: text(),
    phone: text(),
    whatsapp: text(),
    email: citext(),
    address: jsonb().$type<Address>(),
    categories: text().array().notNull().default(sql`'{}'::text[]`),
    /** prazo médio de entrega, em dias */
    leadTimeDays: smallint(),
    /** nota da própria oficina, de 1 a 5 */
    rating: smallint(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('suppliers_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('suppliers_org_document_unique')
      .on(t.organizationId, t.document)
      .where(sql`document is not null and deleted_at is null`),
    index('suppliers_org_name_idx').on(t.organizationId, t.name),
    index('suppliers_name_search_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    index('suppliers_categories_idx').using('gin', t.categories),
    check('suppliers_rating_check', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check('suppliers_lead_time_check', sql`${t.leadTimeDays} is null or ${t.leadTimeDays} between 0 and 365`),
  ],
);
