import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { FOLLOW_UP_STATUSES, FOLLOW_UP_TYPES, LEAD_SOURCES, LEAD_STAGES } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { customers, vehicles } from './customers';
import { organizations, users } from './tenancy';
import { workOrders } from './work-orders';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const money = () => bigint({ mode: 'number' });

/**
 * A fila de pós-venda (docs/DATABASE.md §6, MVP 2, E16). Automação **sem
 * disparo automático**: o sistema descobre quem contatar hoje e escreve a
 * mensagem; quem aperta enviar é uma pessoa (ROADMAP: "automação sem API, com
 * uma pessoa enviando").
 *
 * `dedupe_key` é o que impede a mesma conversa de nascer duas vezes: a fila é
 * recalculada a cada abertura da tela, e sem ela o mesmo "ligar para o João da
 * OS 182" apareceria todo dia.
 */
export const followUps = pgTable(
  'follow_ups',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    type: text({ enum: FOLLOW_UP_TYPES }).notNull(),
    status: text({ enum: FOLLOW_UP_STATUSES }).notNull().default('PENDING'),
    customerId: uuid().notNull(),
    vehicleId: uuid(),
    workOrderId: uuid(),
    /** o dia em que o contato entra na fila */
    dueOn: date({ mode: 'string' }).notNull(),
    /** o motivo, já escrito: "revisão de 10.000 km vence em outubro" */
    reason: text(),
    dedupeKey: text().notNull(),
    doneAt: timestamptz(),
    doneBy: uuid().references(() => users.id),
    outcome: text(),
    ...timestamps,
  },
  (t) => [
    unique('follow_ups_org_id_unique').on(t.organizationId, t.id),
    uniqueIndex('follow_ups_dedupe_unique').on(t.organizationId, t.dedupeKey),
    foreignKey({
      name: 'follow_ups_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'follow_ups_vehicle_fk',
      columns: [t.organizationId, t.vehicleId],
      foreignColumns: [vehicles.organizationId, vehicles.id],
    }),
    foreignKey({
      name: 'follow_ups_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    index('follow_ups_queue_idx').on(t.organizationId, t.status, t.dueOn),
    check('follow_ups_type_check', sql`${t.type} in (${list(FOLLOW_UP_TYPES)})`),
    check('follow_ups_status_check', sql`${t.status} in (${list(FOLLOW_UP_STATUSES)})`),
    check('follow_ups_done_check', sql`(${t.status} = 'PENDING') = (${t.doneAt} is null)`),
  ],
);

/**
 * Avaliação do cliente (E16). O link é público, como o do orçamento: o token
 * é a credencial, e só abre AQUELA avaliação.
 *
 * O convite vai para **todos** os clientes, não só para quem gostou — filtrar
 * por satisfação para pedir estrela no Google é contra as políticas deles, e
 * é desonesto. Uma avaliação por OS.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    workOrderId: uuid().notNull(),
    customerId: uuid().notNull(),
    /** sha256 do token do link; o token em texto não é guardado */
    tokenHash: text().notNull(),
    rating: smallint(),
    comment: text(),
    submittedAt: timestamptz(),
    /** a oficina mandou o convite (wa.me) em algum momento */
    invitedAt: timestamptz(),
    firstViewedAt: timestamptz(),
    ip: text(),
    userAgent: text(),
    /** o cliente foi levado ao Google depois de avaliar */
    googleInvited: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    unique('reviews_org_id_unique').on(t.organizationId, t.id),
    // uma avaliação por OS: duas seriam duas notas para o mesmo serviço
    uniqueIndex('reviews_work_order_unique').on(t.organizationId, t.workOrderId),
    uniqueIndex('reviews_token_unique').on(t.tokenHash),
    foreignKey({
      name: 'reviews_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    foreignKey({
      name: 'reviews_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    index('reviews_submitted_idx').on(t.organizationId, t.submittedAt.desc()),
    check('reviews_rating_check', sql`${t.rating} is null or ${t.rating} between 1 and 5`),
    check('reviews_submitted_check', sql`(${t.rating} is null) = (${t.submittedAt} is null)`),
  ],
);

/**
 * O funil (E16). O orçamento que não virou OS, a ligação que ficou no papel: é
 * aqui que a oficina para de perder negócio em silêncio.
 *
 * O lead vira cliente de verdade quando fecha — e aí `customer_id` aponta para
 * o cadastro criado, sem duplicar gente.
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    name: text().notNull(),
    phone: text(),
    stage: text({ enum: LEAD_STAGES }).notNull().default('NEW'),
    source: text({ enum: LEAD_SOURCES }).notNull().default('OTHER'),
    vehicleDesc: text(),
    need: text(),
    estimatedValueCents: money().notNull().default(0),
    notes: text(),
    lostReason: text(),
    /** quando virou cliente de verdade */
    customerId: uuid(),
    workOrderId: uuid(),
    closedAt: timestamptz(),
    createdBy: uuid().references(() => users.id),
    ...timestamps,
  },
  (t) => [
    unique('leads_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'leads_customer_fk',
      columns: [t.organizationId, t.customerId],
      foreignColumns: [customers.organizationId, customers.id],
    }),
    foreignKey({
      name: 'leads_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    index('leads_stage_idx').on(t.organizationId, t.stage, t.createdAt.desc()),
    index('leads_name_idx').using('gin', sql`immutable_unaccent(name) gin_trgm_ops`),
    check('leads_stage_check', sql`${t.stage} in (${list(LEAD_STAGES)})`),
    check('leads_source_check', sql`${t.source} in (${list(LEAD_SOURCES)})`),
    check('leads_value_check', sql`${t.estimatedValueCents} >= 0`),
    check('leads_lost_check', sql`${t.stage} <> 'LOST' or ${t.lostReason} is not null`),
  ],
);
