import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CUSTOMER_SOURCES, CUSTOMER_TYPES, FUELS, ODOMETER_SOURCES, TRANSMISSIONS } from '@oficinaos/shared';
import { citext, id, timestamps, timestamptz } from './_columns';
import { type Address, organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Cliente da oficina. `UNIQUE (organization_id, id)` existe para as FKs
 * compostas: um veículo da oficina A nunca aponta para cliente da oficina B,
 * garantido pelo banco (DATABASE.md §1.2).
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    type: text({ enum: CUSTOMER_TYPES }).notNull().default('PF'),
    name: text().notNull(),
    /** CPF ou CNPJ normalizado (só dígitos; CNPJ alfanumérico em maiúsculas) */
    document: text(),
    phone: text(),
    whatsapp: text(),
    email: citext(),
    address: jsonb().$type<Address>(),
    notes: text(),
    source: text({ enum: CUSTOMER_SOURCES }),
    marketingOptIn: boolean().notNull().default(false),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('customers_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('customers_org_document_unique')
      .on(t.organizationId, t.document)
      .where(sql`document is not null and deleted_at is null`),
    index('customers_org_name_idx').on(t.organizationId, t.name),
    index('customers_name_search_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    check('customers_type_check', sql`${t.type} in (${list(CUSTOMER_TYPES)})`),
    check('customers_source_check', sql`${t.source} is null or ${t.source} in (${list(CUSTOMER_SOURCES)})`),
  ],
);

/**
 * Veículo. `plate` guarda como foi digitada (normalizada); `plate_canonical`
 * guarda sempre o formato Mercosul, para que ABC1234 e ABC1C34 sejam o mesmo carro.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    customerId: uuid().notNull(),
    plate: text(),
    plateCanonical: text(),
    make: text().notNull(),
    model: text().notNull(),
    version: text(),
    engine: text(),
    color: text(),
    yearManufacture: smallint(),
    yearModel: smallint(),
    fuel: text({ enum: FUELS }),
    transmission: text({ enum: TRANSMISSIONS }),
    vin: text(),
    /** último km conhecido (cache de odometer_readings) */
    odometerKm: integer(),
    odometerUpdatedAt: timestamptz(),
    notes: text(),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('vehicles_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'vehicles_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    uniqueIndex('vehicles_org_plate_unique')
      .on(t.organizationId, t.plateCanonical)
      .where(sql`plate_canonical is not null and deleted_at is null`),
    index('vehicles_org_plate_prefix_idx').on(t.organizationId, t.plateCanonical.op('text_pattern_ops')),
    index('vehicles_org_customer_idx').on(t.organizationId, t.customerId),
    index('vehicles_model_search_idx').using('gin', sql`immutable_unaccent(make || ' ' || model) gin_trgm_ops`),
    check('vehicles_fuel_check', sql`${t.fuel} is null or ${t.fuel} in (${list(FUELS)})`),
    check(
      'vehicles_transmission_check',
      sql`${t.transmission} is null or ${t.transmission} in (${list(TRANSMISSIONS)})`,
    ),
    check('vehicles_years_check', sql`${t.yearManufacture} is null or ${t.yearManufacture} between 1950 and 2100`),
    check('vehicles_odometer_check', sql`${t.odometerKm} is null or ${t.odometerKm} >= 0`),
  ],
);

/** Leituras de quilometragem ao longo do tempo: base de "troca de óleo há 8.000 km". */
export const odometerReadings = pgTable(
  'odometer_readings',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    vehicleId: uuid().notNull(),
    km: integer().notNull(),
    source: text({ enum: ODOMETER_SOURCES }).notNull(),
    /** FK entra junto com work_orders (E5) */
    workOrderId: uuid(),
    recordedBy: uuid().references(() => users.id),
    recordedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'odometer_readings_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('odometer_readings_vehicle_idx').on(t.organizationId, t.vehicleId, t.recordedAt.desc()),
    check('odometer_readings_km_check', sql`${t.km} >= 0`),
    check('odometer_readings_source_check', sql`${t.source} in (${list(ODOMETER_SOURCES)})`),
  ],
);
