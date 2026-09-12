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
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  APPROVAL_CHANNELS,
  APPROVAL_DECISIONS,
  QUOTE_KINDS,
  QUOTE_STATUSES,
  SHARE_CHANNELS,
  WORK_ORDER_ITEM_TYPES,
} from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { attachments, workOrderItems, workOrders } from './work-orders';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));
const quantity = () => numeric({ precision: 12, scale: 3 });
const money = () => bigint({ mode: 'number' });

export interface QuoteSnapshot {
  shop: { name: string; phone?: string | null; whatsapp?: string | null; city?: string | null; state?: string | null };
  customer: { name: string };
  vehicle: { make: string; model: string; version?: string | null; plate?: string | null; yearLabel?: string | null };
  message?: string | null;
  warranty?: { days?: number | null; km?: number | null };
}

/**
 * Orçamento: SNAPSHOT do que o cliente viu (docs/DATABASE.md §5.6). A OS é
 * viva; isto não muda depois de enviado. `content_hash` cobre snapshot + itens
 * e é conferido na aprovação: ninguém aprova um valor e recebe outro.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    number: integer().notNull(),
    workOrderId: uuid().notNull(),
    /** 1, 2, 3… por OS: editar item pendente gera versão nova */
    version: integer().notNull().default(1),
    kind: text({ enum: QUOTE_KINDS }).notNull().default('INITIAL'),
    status: text({ enum: QUOTE_STATUSES }).notNull().default('SENT'),
    /** 32 bytes aleatórios em base64url: é a credencial da página pública */
    publicToken: text().notNull().unique(),
    validUntil: timestamptz().notNull(),
    snapshot: jsonb().$type<QuoteSnapshot>().notNull(),
    contentHash: text().notNull(),
    subtotalCents: money().notNull().default(0),
    discountCents: money().notNull().default(0),
    surchargeCents: money().notNull().default(0),
    totalCents: money().notNull().default(0),
    sentAt: timestamptz().notNull().defaultNow(),
    sentBy: uuid().references(() => users.id),
    sentChannel: text({ enum: SHARE_CHANNELS }),
    firstViewedAt: timestamptz(),
    lastViewedAt: timestamptz(),
    viewCount: integer().notNull().default(0),
    decidedAt: timestamptz(),
    supersededByQuoteId: uuid(),
    ...timestamps,
  },
  (t) => [
    unique('quotes_org_id_unique').on(t.organizationId, t.id),
    unique('quotes_org_number_unique').on(t.organizationId, t.number),
    foreignKey({
      name: 'quotes_work_order_fk',
      columns: [t.organizationId, t.workOrderId],
      foreignColumns: [workOrders.organizationId, workOrders.id],
    }),
    /** uma versão aberta por OS: o cliente nunca recebe dois links valendo */
    uniqueIndex('quotes_one_open_per_work_order')
      .on(t.organizationId, t.workOrderId)
      .where(sql`status = 'SENT'`),
    index('quotes_org_status_idx').on(t.organizationId, t.status, t.sentAt.desc()),
    check('quotes_status_check', sql`${t.status} in (${list(QUOTE_STATUSES)})`),
    check('quotes_kind_check', sql`${t.kind} in (${list(QUOTE_KINDS)})`),
    check('quotes_number_check', sql`${t.number} > 0`),
    check('quotes_money_check', sql`${t.totalCents} >= 0 and ${t.discountCents} >= 0`),
    check('quotes_view_count_check', sql`${t.viewCount} >= 0`),
  ],
);

/** Itens congelados. IMUTÁVEIS: é o que o cliente viu na tela. */
export const quoteItems = pgTable(
  'quote_items',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    quoteId: uuid().notNull(),
    workOrderItemId: uuid().notNull(),
    type: text({ enum: WORK_ORDER_ITEM_TYPES }).notNull(),
    description: text().notNull(),
    partCode: text(),
    brand: text(),
    quantity: quantity().notNull(),
    unitPriceCents: money().notNull(),
    discountCents: money().notNull().default(0),
    totalCents: money().notNull(),
    isOptional: boolean().notNull().default(false),
    position: integer().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('quote_items_org_id_unique').on(t.organizationId, t.id),
    foreignKey({
      name: 'quote_items_quote_fk',
      columns: [t.organizationId, t.quoteId],
      foreignColumns: [quotes.organizationId, quotes.id],
    }),
    foreignKey({
      name: 'quote_items_work_order_item_fk',
      columns: [t.organizationId, t.workOrderItemId],
      foreignColumns: [workOrderItems.organizationId, workOrderItems.id],
    }),
    index('quote_items_quote_idx').on(t.organizationId, t.quoteId, t.position),
    check('quote_items_type_check', sql`${t.type} in (${list(WORK_ORDER_ITEM_TYPES)})`),
    check('quote_items_quantity_check', sql`${t.quantity} > 0`),
    check('quote_items_money_check', sql`${t.unitPriceCents} >= 0 and ${t.totalCents} >= 0`),
  ],
);

/** Quais fotos o cliente vê, e junto de qual item. */
export const quoteAttachments = pgTable(
  'quote_attachments',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    quoteId: uuid().notNull(),
    attachmentId: uuid().notNull(),
    quoteItemId: uuid(),
    caption: text(),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.quoteId, t.attachmentId] }),
    foreignKey({
      name: 'quote_attachments_quote_fk',
      columns: [t.organizationId, t.quoteId],
      foreignColumns: [quotes.organizationId, quotes.id],
    }),
    foreignKey({
      name: 'quote_attachments_attachment_fk',
      columns: [t.organizationId, t.attachmentId],
      foreignColumns: [attachments.organizationId, attachments.id],
    }),
    foreignKey({
      name: 'quote_attachments_item_fk',
      columns: [t.organizationId, t.quoteItemId],
      foreignColumns: [quoteItems.organizationId, quoteItems.id],
    }),
  ],
);

/**
 * Registro de prova, imutável: UMA decisão por orçamento (o UNIQUE em
 * `quote_id` é o que torna a aprovação dupla impossível, mesmo com duas abas).
 */
export const quoteApprovals = pgTable(
  'quote_approvals',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    quoteId: uuid().notNull().unique(),
    decision: text({ enum: APPROVAL_DECISIONS }).notNull(),
    channel: text({ enum: APPROVAL_CHANNELS }).notNull(),
    approvedQuoteItemIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    approvedTotalCents: money().notNull().default(0),
    /** nome digitado pelo cliente na confirmação */
    signerName: text(),
    rejectionReason: text(),
    /** só no canal PUBLIC_LINK: é a assinatura eletrônica simples */
    ip: text(),
    userAgent: text(),
    contentHash: text().notNull(),
    /** decisão por telefone/presencial: quem da equipe registrou */
    recordedByUserId: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'quote_approvals_quote_fk',
      columns: [t.organizationId, t.quoteId],
      foreignColumns: [quotes.organizationId, quotes.id],
    }),
    check('quote_approvals_decision_check', sql`${t.decision} in (${list(APPROVAL_DECISIONS)})`),
    check('quote_approvals_channel_check', sql`${t.channel} in (${list(APPROVAL_CHANNELS)})`),
    /** pelo link, a prova exige nome e aparelho; registrada pela equipe, exige quem registrou */
    check(
      'quote_approvals_proof_check',
      sql`(${t.channel} = 'PUBLIC_LINK' and ${t.signerName} is not null) or (${t.channel} <> 'PUBLIC_LINK' and ${t.recordedByUserId} is not null)`,
    ),
  ],
);
