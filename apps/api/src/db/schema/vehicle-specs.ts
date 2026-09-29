import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core';
import { SPEC_GROUPS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * Ficha do carro (E31) — catálogo da PLATAFORMA.
 *
 * Tabelas GLOBAIS, sem RLS de tenant: o dado não é de nenhuma oficina, é
 * nosso, e todas leem o mesmo. Por isso não têm `organization_id` — e por isso
 * estão registradas em GLOBAL_TABLES no teste de guarda do RLS, ao lado de
 * `plans`. Quem escreve é só administrador da plataforma; a oficina lê o que
 * estiver publicado.
 */
export const catalogVehicles = pgTable(
  'catalog_vehicles',
  {
    id: id(),
    make: text().notNull(),
    model: text().notNull(),
    /** "1.0 8V", "G6 1.6 MSI": é o que separa uma ficha da outra */
    version: text(),
    yearFrom: smallint(),
    yearTo: smallint(),
    notes: text(),
    /** rascunho não aparece para a oficina: meia ficha é pior que ficha nenhuma */
    publishedAt: timestamptz(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    // a mesma marca/modelo/versão/faixa de ano não pode virar duas fichas
    unique('catalog_vehicles_identity_unique').on(t.make, t.model, t.version, t.yearFrom, t.yearTo),
    index('catalog_vehicles_search_idx').using(
      'gin',
      sql`immutable_unaccent(${t.make} || ' ' || ${t.model} || ' ' || coalesce(${t.version}, '')) gin_trgm_ops`,
    ),
    check('catalog_vehicles_years_check', sql`${t.yearFrom} is null or ${t.yearTo} is null or ${t.yearFrom} <= ${t.yearTo}`),
  ],
);

/**
 * Uma linha da ficha. `key` vem de SPEC_ITEMS (lista fixa) ou fica vazia
 * quando é um item específico daquele carro, e aí `custom_label` manda.
 */
export const catalogVehicleSpecs = pgTable(
  'catalog_vehicle_specs',
  {
    id: id(),
    vehicleId: uuid()
      .notNull()
      .references(() => catalogVehicles.id, { onDelete: 'cascade' }),
    key: text(),
    customLabel: text(),
    group: text({ enum: SPEC_GROUPS }).notNull(),
    value: text().notNull(),
    note: text(),
    /** de onde veio o valor (E35): manual, catálogo do fabricante, medição */
    source: text(),
    position: integer().notNull().default(0),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('catalog_vehicle_specs_vehicle_idx').on(t.vehicleId, t.position),
    check('catalog_vehicle_specs_group_check', sql`${t.group} in (${list(SPEC_GROUPS)})`),
    // ou é item da lista fixa, ou tem rótulo próprio: nunca nenhum dos dois
    check(
      'catalog_vehicle_specs_label_check',
      sql`(${t.key} is not null and ${t.key} <> '') or (${t.customLabel} is not null and ${t.customLabel} <> '')`,
    ),
  ],
);

/**
 * "Não achei o meu carro". Guarda QUEM pediu para não contar a mesma oficina
 * duas vezes — a contagem vira a fila de quem preenche, e uma oficina
 * insistente não pode furar a fila sozinha.
 */
export const catalogVehicleRequests = pgTable(
  'catalog_vehicle_requests',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    make: text().notNull(),
    model: text().notNull(),
    year: smallint(),
    note: text(),
    requestedBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('catalog_vehicle_requests_once').on(t.organizationId, t.make, t.model, t.year),
    index('catalog_vehicle_requests_recent_idx').on(t.createdAt.desc()),
  ],
);
