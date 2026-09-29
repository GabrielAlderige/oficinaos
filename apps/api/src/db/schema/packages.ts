import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { id, timestamps, timestamptz } from './_columns';
import { parts, services } from './catalog';
import { organizations, users } from './tenancy';

/**
 * Pacote de serviço (E27): "Revisão dos 10.000 km" leva os serviços e as peças
 * de uma vez para a OS.
 *
 * O pacote **não congela preço**: ele guarda o que entra e quanto, e o preço
 * sai do catálogo no dia em que a oficina usa. Guardar o preço aqui criaria
 * uma segunda tabela de preços para manter — e um pacote esquecido cobrando
 * o valor do ano passado.
 */
export const servicePackages = pgTable(
  'service_packages',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    description: text(),
    isActive: boolean().notNull().default(true),
    createdBy: uuid().references(() => users.id),
    deletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [
    unique('service_packages_org_id_unique').on(t.organizationId, t.id),
    index('service_packages_name_idx').on(t.organizationId, t.name),
  ],
);

/**
 * O que o pacote leva. `serviceId` ou `partId`, nunca os dois — o CHECK é a
 * garantia de que ninguém grava uma linha que a tela não sabe desenhar.
 */
export const servicePackageItems = pgTable(
  'service_package_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    packageId: uuid().notNull(),
    serviceId: uuid(),
    partId: uuid(),
    quantity: numeric({ precision: 12, scale: 3 }).notNull().default('1'),
    position: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'service_package_items_package_fk',
      columns: [t.organizationId, t.packageId],
      foreignColumns: [servicePackages.organizationId, servicePackages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'service_package_items_service_fk',
      columns: [t.organizationId, t.serviceId],
      foreignColumns: [services.organizationId, services.id],
    }),
    foreignKey({
      name: 'service_package_items_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('service_package_items_package_idx').on(t.organizationId, t.packageId, t.position),
    check(
      'service_package_items_kind_check',
      sql`(${t.serviceId} is not null and ${t.partId} is null) or (${t.serviceId} is null and ${t.partId} is not null)`,
    ),
    check('service_package_items_quantity_check', sql`${t.quantity} > 0`),
  ],
);
