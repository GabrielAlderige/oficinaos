import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { MESSAGE_CHANNELS, MESSAGE_DIRECTIONS, MESSAGE_STATUSES, NOTIFICATION_TYPES } from '@oficinaos/shared';
import { id, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * Aviso dentro do painel (docs/DATABASE.md §5.8). Uma linha por destinatário:
 * o fan-out acontece na criação, porque "quem já leu" é de cada pessoa.
 * A oficina descobre que o orçamento foi aprovado por aqui.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text({ enum: NOTIFICATION_TYPES }).notNull(),
    title: text().notNull(),
    body: text(),
    /** para onde o clique leva, ex.: /ordens/182 */
    link: text(),
    /**
     * Sem FK de propósito: o aviso é histórico do que aconteceu e sobrevive se
     * a OS ou o orçamento sumirem. O `link` é que leva a pessoa ao destino.
     */
    workOrderId: uuid(),
    quoteId: uuid(),
    readAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('notifications_user_idx').on(t.organizationId, t.userId, t.readAt, t.createdAt.desc()),
    check('notifications_type_check', sql`${t.type} in (${list(NOTIFICATION_TYPES)})`),
  ],
);

/**
 * Histórico de comunicação com o cliente. No V1 o WhatsApp é link `wa.me`:
 * o máximo que sabemos é que a oficina ABRIU o link (`LINK_OPENED`) — dizer
 * "entregue" sem a API oficial seria mentira de tela.
 */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    customerId: uuid(),
    channel: text({ enum: MESSAGE_CHANNELS }).notNull(),
    direction: text({ enum: MESSAGE_DIRECTIONS }).notNull().default('OUTBOUND'),
    templateKey: text(),
    body: text().notNull(),
    toAddress: text(),
    workOrderId: uuid(),
    quoteId: uuid(),
    status: text({ enum: MESSAGE_STATUSES }).notNull(),
    sentBy: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('messages_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('messages_customer_idx').on(t.organizationId, t.customerId, t.createdAt.desc()),
    check('messages_channel_check', sql`${t.channel} in (${list(MESSAGE_CHANNELS)})`),
    check('messages_direction_check', sql`${t.direction} in (${list(MESSAGE_DIRECTIONS)})`),
    check('messages_status_check', sql`${t.status} in (${list(MESSAGE_STATUSES)})`),
  ],
);
