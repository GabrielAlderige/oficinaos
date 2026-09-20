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
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { FISCAL_ENVIRONMENTS, INVOICE_KINDS, INVOICE_STATUSES, TAX_REGIMES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers, vehicles } from './customers';
import { organizations, users } from './tenancy';
import { workOrderItems, workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });
const quantity = () => numeric({ precision: 12, scale: 3 });

/**
 * Dados fiscais da oficina (V3, E18). Tabela própria, 1:1 com a oficina, em
 * vez de mais quinze colunas em `organizations`: só quem emite nota precisa
 * disso, e a nota de PEÇA (etapa futura) traz outra dúzia de campos.
 *
 * **Não guardamos certificado digital nem senha.** Quem assina a nota é o
 * emissor; aqui fica só o identificador da empresa lá (`provider_company_id`).
 * Segredo que não passa pelo nosso banco é segredo que não vaza dele.
 */
export const organizationFiscalSettings = pgTable(
  'organization_fiscal_settings',
  {
    organizationId: uuid()
      .primaryKey()
      .references(() => organizations.id),
    municipalRegistration: text(),
    stateRegistration: text(),
    taxRegime: text({ enum: TAX_REGIMES }),
    cnae: text(),
    /** item da lista da LC 116 (oficina costuma ser 14.01) */
    serviceListItem: text(),
    municipalServiceCode: text(),
    /** alíquota do ISS em pontos-base: 2,5% = 250 */
    issRateBps: integer(),
    issRetainedDefault: boolean().notNull().default(false),
    rpsSeries: text().notNull().default('1'),
    environment: text({ enum: FISCAL_ENVIRONMENTS }).notNull().default('SIMULATOR'),
    provider: text(),
    providerCompanyId: text(),
    additionalInformation: text(),
    ...timestamps,
  },
  (t) => [
    check('org_fiscal_regime_check', sql`${t.taxRegime} is null or ${t.taxRegime} in (${list(TAX_REGIMES)})`),
    check('org_fiscal_environment_check', sql`${t.environment} in (${list(FISCAL_ENVIRONMENTS)})`),
    check('org_fiscal_iss_check', sql`${t.issRateBps} is null or (${t.issRateBps} >= 0 and ${t.issRateBps} <= 10000)`),
  ],
);

/**
 * A nota emitida. O que está aqui é **cópia congelada** do que foi para a
 * prefeitura: mudar a OS depois não reescreve nota nenhuma, do mesmo jeito que
 * o orçamento (E6). Mexer numa nota autorizada é cancelar e emitir outra.
 *
 * `rps_number` é nosso (Recibo Provisório de Serviços, numeração sequencial
 * por oficina); `invoice_number` é o número que a prefeitura devolve.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    kind: text({ enum: INVOICE_KINDS }).notNull().default('NFSE'),
    status: text({ enum: INVOICE_STATUSES }).notNull().default('DRAFT'),
    environment: text({ enum: FISCAL_ENVIRONMENTS }).notNull(),
    provider: text(),
    workOrderId: uuid().notNull(),
    customerId: uuid().notNull(),
    vehicleId: uuid(),
    rpsNumber: integer().notNull(),
    rpsSeries: text().notNull(),
    invoiceNumber: text(),
    verificationCode: text(),
    providerRef: text(),
    publicUrl: text(),
    pdfUrl: text(),
    xmlUrl: text(),
    /** o mesmo POST repetido devolve a mesma nota, não emite duas (D32) */
    clientRequestId: uuid().notNull(),
    serviceAmountCents: money().notNull(),
    deductionsCents: money().notNull().default(0),
    discountCents: money().notNull().default(0),
    baseAmountCents: money().notNull(),
    issRateBps: integer().notNull(),
    issAmountCents: money().notNull(),
    issRetained: boolean().notNull().default(false),
    irrfCents: money().notNull().default(0),
    pisCents: money().notNull().default(0),
    cofinsCents: money().notNull().default(0),
    csllCents: money().notNull().default(0),
    inssCents: money().notNull().default(0),
    totalCents: money().notNull(),
    netCents: money().notNull(),
    /** a discriminação que o cliente lê no site da prefeitura */
    description: text().notNull(),
    /** a última resposta do emissor, inteira: é o que explica uma rejeição */
    providerResponse: jsonb().$type<Record<string, unknown>>(),
    rejectionReason: text(),
    issuedAt: timestamptz(),
    canceledAt: timestamptz(),
    cancelReason: text(),
    canceledBy: uuid().references(() => users.id),
    createdBy: uuid()
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('invoices_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('invoices_rps_unique').on(t.organizationId, t.kind, t.rpsSeries, t.rpsNumber),
    uniqueIndex('invoices_client_request_unique').on(t.organizationId, t.clientRequestId),
    foreignKey({
      name: 'invoices_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'invoices_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'invoices_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    index('invoices_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('invoices_work_order_idx').on(t.organizationId, t.workOrderId),
    check('invoices_kind_check', sql`${t.kind} in (${list(INVOICE_KINDS)})`),
    check('invoices_status_check', sql`${t.status} in (${list(INVOICE_STATUSES)})`),
    check('invoices_environment_check', sql`${t.environment} in (${list(FISCAL_ENVIRONMENTS)})`),
    check('invoices_money_check', sql`${t.totalCents} >= 0 and ${t.baseAmountCents} >= 0 and ${t.issAmountCents} >= 0`),
    check('invoices_rps_check', sql`${t.rpsNumber} > 0`),
    // cancelada sem motivo não conta história: a mesma regra do pagamento (E7)
    check(
      'invoices_canceled_check',
      sql`(${t.status} = 'CANCELED') = (${t.canceledAt} is not null) and (${t.canceledAt} is null or ${t.cancelReason} is not null)`,
    ),
    // autorizada é o único estado em que a prefeitura já devolveu número
    check('invoices_authorized_check', sql`${t.status} <> 'AUTHORIZED' or ${t.issuedAt} is not null`),
  ],
);

/** Os serviços que entraram na nota, congelados como o orçamento congela. */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    invoiceId: uuid().notNull(),
    /** ponteiro, não a verdade: vira null se o item sair da OS depois (D36) */
    workOrderItemId: uuid(),
    description: text().notNull(),
    quantity: quantity().notNull(),
    unitPriceCents: money().notNull(),
    totalCents: money().notNull(),
    position: integer().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('invoice_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'invoice_items_invoice_fk',
      columns: [t.organizationId, t.invoiceId],
      foreignColumns: [invoices.organizationId, invoices.id],
    }),
    foreignKey({
      name: 'invoice_items_work_order_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    index('invoice_items_invoice_idx').on(t.organizationId, t.invoiceId, t.position),
    check('invoice_items_quantity_check', sql`${t.quantity} > 0`),
    check('invoice_items_money_check', sql`${t.unitPriceCents} >= 0 and ${t.totalCents} >= 0`),
  ],
);
