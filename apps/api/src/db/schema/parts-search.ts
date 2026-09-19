import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { PART_OFFER_AVAILABILITIES, PART_SEARCH_PROVIDERS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { parts } from './catalog';
import { suppliers } from './suppliers';
import { organizations, users } from './tenancy';
import { vehicles } from './customers';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * A lista de preço que o fornecedor mandou (docs/DATABASE.md §6, E14),
 * importada de CSV no cadastro dele. É a fonte de preço mais realista depois da
 * cotação: a planilha que chega por WhatsApp toda semana.
 */
export const supplierPriceListItems = pgTable(
  'supplier_price_list_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    supplierId: uuid().notNull(),
    /** código do fornecedor; é por ele que a próxima importação atualiza o preço */
    code: text(),
    name: text().notNull(),
    brand: text(),
    priceCents: money().notNull(),
    unit: text(),
    /** em que importação esta linha entrou (para trocar a lista inteira) */
    importBatch: uuid().notNull(),
    ...timestamps,
  },
  (t) => [
    unique('supplier_price_list_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'supplier_price_list_items_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    // o mesmo código não aparece duas vezes na lista do mesmo fornecedor
    uniqueIndex('supplier_price_list_items_code_unique')
      .on(t.organizationId, t.supplierId, sql`lower(code)`)
      .where(sql`code is not null`),
    index('supplier_price_list_items_supplier_idx').on(t.organizationId, t.supplierId, t.name),
    index('supplier_price_list_items_name_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    check('supplier_price_list_items_price_check', sql`${t.priceCents} >= 0`),
  ],
);

/**
 * Cada busca feita na tela de pesquisa de peças. Guardar é o que permite dizer
 * depois "este custo veio da lista da Central, consultada em 18/09 às 14:32" —
 * e é a base do histórico de preço.
 */
export const partSearchQueries = pgTable(
  'part_search_queries',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    query: text().notNull(),
    vehicleId: uuid(),
    providers: text().array().notNull().default(sql`'{}'::text[]`),
    requestedBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('part_search_queries_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'part_search_queries_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('part_search_queries_org_idx').on(t.organizationId, t.createdAt.desc()),
  ],
);

/**
 * O que cada provider devolveu. `is_mock` é coluna **e** aparece na interface:
 * oferta de provider de desenvolvimento nunca pode ser confundida com preço
 * real (docs/DATABASE.md §6).
 */
export const partOffers = pgTable(
  'part_offers',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    queryId: uuid().notNull(),
    provider: text({ enum: PART_SEARCH_PROVIDERS }).notNull(),
    isMock: boolean().notNull().default(false),
    supplierId: uuid(),
    /** quando a oferta é uma peça do catálogo da oficina */
    partId: uuid(),
    title: text().notNull(),
    brand: text(),
    code: text(),
    priceCents: money().notNull(),
    shippingCents: money().notNull().default(0),
    availability: text({ enum: PART_OFFER_AVAILABILITIES }).notNull(),
    leadTimeDays: smallint(),
    availableQuantity: numeric({ precision: 12, scale: 3 }),
    offerUrl: text(),
    /** o que o provider devolveu, cru: serve para depurar sem refazer a busca */
    raw: jsonb(),
    fetchedAt: timestamptz().notNull().defaultNow(),
    position: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('part_offers_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'part_offers_query_fk',
      columns: [t.organizationId, t.queryId],
      foreignColumns: [partSearchQueries.organizationId, partSearchQueries.id],
    }),
    foreignKey({
      name: 'part_offers_supplier_fk',
      columns: [t.organizationId, t.supplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    foreignKey({
      name: 'part_offers_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('part_offers_query_idx').on(t.organizationId, t.queryId, t.position),
    check('part_offers_provider_check', sql`${t.provider} in (${list(PART_SEARCH_PROVIDERS)})`),
    check('part_offers_availability_check', sql`${t.availability} in (${list(PART_OFFER_AVAILABILITIES)})`),
    check('part_offers_price_check', sql`${t.priceCents} >= 0 and ${t.shippingCents} >= 0`),
  ],
);
