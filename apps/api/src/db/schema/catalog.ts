import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MOVEMENT_TYPES, PART_UNITS, PRICING_MODES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { suppliers } from './suppliers';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/** Quantidade: numeric(12,3). O pg devolve TEXTO; o domínio converte para milésimos (shared/quantity). */
const quantity = () => numeric({ precision: 12, scale: 3 });
const money = () => bigint({ mode: 'number' });

/** Serviço de mão de obra do catálogo: o que a oficina cobra (preço fixo ou por hora técnica). */
export const services = pgTable(
  'services',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    category: text(),
    description: text(),
    pricingMode: text({ enum: PRICING_MODES }).notNull().default('FIXED'),
    priceCents: money(),
    estimatedMinutes: integer(),
    intervalKm: integer(),
    intervalMonths: integer(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('services_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('services_org_name_unique').on(t.organizationId, sql`lower(name)`).where(sql`deleted_at is null`),
    index('services_name_search_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    check('services_pricing_mode_check', sql`${t.pricingMode} in (${list(PRICING_MODES)})`),
    check('services_price_check', sql`${t.priceCents} is null or ${t.priceCents} >= 0`),
  ],
);

/** Categorias de peça por oficina (as 11 padrão nascem com a oficina). */
export const partCategories = pgTable(
  'part_categories',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    position: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('part_categories_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('part_categories_org_name_unique').on(t.organizationId, sql`lower(name)`),
  ],
);

/**
 * Peça do catálogo + saldo em estoque. O saldo é CACHE do livro-razão
 * `inventory_movements`, atualizado na mesma transação com a peça travada.
 * Disponível = em estoque − reservado (reserva nasce na aprovação da OS, E6).
 */
export const parts = pgTable(
  'parts',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    sku: text(),
    manufacturerCode: text(),
    manufacturer: text(),
    categoryId: uuid(),
    description: text(),
    unit: text({ enum: PART_UNITS }).notNull().default('UN'),
    ean: text(),
    ncm: text(),
    lastCostCents: money(),
    averageCostCents: money(),
    salePriceCents: money(),
    markupBps: integer(),
    trackStock: boolean().notNull().default(true),
    quantityOnHand: quantity().notNull().default('0'),
    quantityReserved: quantity().notNull().default('0'),
    minQuantity: quantity().notNull().default('0'),
    location: text(),
    /** de quem a oficina costuma comprar esta peça; a cotação (E11) começa por ele */
    preferredSupplierId: uuid(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('parts_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'parts_category_fk',
      columns: [t.organizationId, t.categoryId],
      foreignColumns: [partCategories.organizationId, partCategories.id],
    }),
    foreignKey({
      name: 'parts_preferred_supplier_fk',
      columns: [t.organizationId, t.preferredSupplierId],
      foreignColumns: [suppliers.organizationId, suppliers.id],
    }),
    index('parts_org_preferred_supplier_idx').on(t.organizationId, t.preferredSupplierId),
    uniqueIndex('parts_org_sku_unique')
      .on(t.organizationId, sql`lower(sku)`)
      .where(sql`sku is not null and deleted_at is null`),
    index('parts_name_search_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    index('parts_org_manufacturer_code_idx').on(t.organizationId, t.manufacturerCode.op('text_pattern_ops')),
    index('parts_org_category_idx').on(t.organizationId, t.categoryId),
    check('parts_unit_check', sql`${t.unit} in (${list(PART_UNITS)})`),
    check('parts_quantities_check', sql`${t.quantityReserved} >= 0 and ${t.minQuantity} >= 0`),
    check('parts_prices_check', sql`coalesce(${t.salePriceCents}, 0) >= 0 and coalesce(${t.lastCostCents}, 0) >= 0`),
  ],
);

/** Em que carro a peça serve. É referência para quem busca; quem confirma é a pessoa. */
export const partApplications = pgTable(
  'part_applications',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    partId: uuid().notNull(),
    make: text().notNull(),
    model: text(),
    engine: text(),
    yearFrom: smallint(),
    yearTo: smallint(),
    notes: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'part_applications_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('part_applications_part_idx').on(t.organizationId, t.partId),
    index('part_applications_search_idx').using(
      'gin',
      sql`immutable_unaccent(make || ' ' || coalesce(model, '') || ' ' || coalesce(engine, '')) gin_trgm_ops`,
    ),
  ],
);

/**
 * Livro-razão do estoque. IMUTÁVEL (a role da aplicação não tem UPDATE/DELETE):
 * o saldo de qualquer dia é a soma dos movimentos até ali.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    partId: uuid().notNull(),
    type: text({ enum: MOVEMENT_TYPES }).notNull(),
    /** com sinal: + entra, − sai */
    quantity: quantity().notNull(),
    unitCostCents: money(),
    balanceAfter: quantity().notNull(),
    averageCostAfterCents: money(),
    /** FKs entram com as tabelas (E5/E6 e compras no MVP 2) */
    workOrderId: uuid(),
    workOrderItemId: uuid(),
    purchaseOrderId: uuid(),
    reason: text(),
    createdBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'inventory_movements_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('inventory_movements_part_idx').on(t.organizationId, t.partId, t.createdAt.desc()),
    check('inventory_movements_type_check', sql`${t.type} in (${list(MOVEMENT_TYPES)})`),
    check('inventory_movements_quantity_check', sql`${t.quantity} <> 0`),
  ],
);
