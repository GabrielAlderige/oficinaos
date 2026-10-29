import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { COUNTER_SALE_STATUSES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { parts } from './catalog';
import { customers } from './customers';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * Venda de balcão (E49): a peça vendida sem ordem de serviço.
 *
 * Não se edita: a venda nasce concluída (a peça já saiu, o dinheiro já
 * entrou ou virou conta a receber) e só pode ser CANCELADA, com motivo — o
 * que devolve a peça ao estoque e cancela a conta. É o mesmo princípio do
 * pagamento da E7: errou, desfaz com registro, não apaga.
 */
export const counterSales = pgTable(
  'counter_sales',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    /** "Venda 37", da numeração da oficina */
    number: integer().notNull(),
    status: text({ enum: COUNTER_SALE_STATUSES }).notNull().default('COMPLETED'),
    /** opcional: quem passa e leva um óleo não precisa de cadastro */
    customerId: uuid(),
    subtotalCents: money().notNull(),
    discountCents: money().notNull().default(0),
    totalCents: money().notNull(),
    notes: text(),
    /** gerado pela tela: o mesmo POST repetido devolve a venda que já existe */
    clientRequestId: uuid().notNull(),
    soldAt: timestamptz().notNull().defaultNow(),
    soldBy: uuid().references(() => users.id),
    canceledAt: timestamptz(),
    canceledBy: uuid().references(() => users.id),
    cancelReason: text(),
    ...timestamps,
  },
  (t) => [
    unique('counter_sales_org_id_unique').on(t.organizationId, t.id),
    unique('counter_sales_org_number_unique').on(t.organizationId, t.number),
    unique('counter_sales_client_request_unique').on(t.organizationId, t.clientRequestId),
    foreignKey({
      name: 'counter_sales_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    index('counter_sales_sold_idx').on(t.organizationId, t.soldAt.desc()),
    index('counter_sales_customer_idx').on(t.organizationId, t.customerId),
    check('counter_sales_status_check', sql`${t.status} in (${list(COUNTER_SALE_STATUSES)})`),
    check('counter_sales_number_check', sql`${t.number} > 0`),
    check(
      'counter_sales_amounts_check',
      sql`${t.subtotalCents} >= 0 and ${t.discountCents} >= 0 and ${t.discountCents} <= ${t.subtotalCents} and ${t.totalCents} = ${t.subtotalCents} - ${t.discountCents}`,
    ),
    check(
      'counter_sales_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * O que foi vendido. Com `partId` a peça sai do estoque; sem, é um item
 * avulso (uma mão de obra rápida, um produto fora do catálogo) que só entra
 * no valor. `unitCostCents` congela o custo médio da hora da venda: é ele que
 * o lucro usa, e não o custo de hoje.
 */
export const counterSaleItems = pgTable(
  'counter_sale_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    saleId: uuid().notNull(),
    partId: uuid(),
    description: text().notNull(),
    quantity: numeric({ precision: 12, scale: 3 }).notNull(),
    unitPriceCents: money().notNull(),
    unitCostCents: money(),
    totalCents: money().notNull(),
    position: integer().notNull().default(0),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'counter_sale_items_sale_fk',
      columns: [t.organizationId, t.saleId],
      foreignColumns: [counterSales.organizationId, counterSales.id],
    }),
    foreignKey({
      name: 'counter_sale_items_part_fk',
      columns: [t.organizationId, t.partId],
      foreignColumns: [parts.organizationId, parts.id],
    }),
    index('counter_sale_items_sale_idx').on(t.organizationId, t.saleId, t.position),
    check('counter_sale_items_quantity_check', sql`${t.quantity} > 0`),
    check('counter_sale_items_amounts_check', sql`${t.unitPriceCents} >= 0 and ${t.totalCents} >= 0`),
  ],
);
