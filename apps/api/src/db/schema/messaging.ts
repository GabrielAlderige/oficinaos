import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  CHANNEL_STATUSES,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGING_PROVIDERS,
  TEMPLATE_STATUSES,
} from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * O WhatsApp da oficina (V3, E22). Uma linha por oficina, e as credenciais são
 * **dela**: cada oficina cria a própria conta na Meta e cola aqui.
 *
 * O token é guardado **cifrado** (AES-256-GCM, chave no ambiente do servidor)
 * e nunca volta para a tela — a resposta mostra só os quatro últimos
 * caracteres, o suficiente para conferir que foi colado o certo. Não é tão bom
 * quanto não guardar (é o que fazemos com o certificado fiscal, D38), mas aqui
 * não há escolha: quem envia a mensagem é o servidor, e ele precisa do token.
 */
export const messagingChannels = pgTable(
  'messaging_channels',
  {
    organizationId: uuid()
      .primaryKey()
      .references(() => organizations.id),
    provider: text({ enum: MESSAGING_PROVIDERS }).notNull().default('LINK'),
    status: text({ enum: CHANNEL_STATUSES }).notNull().default('DISCONNECTED'),
    phoneNumberId: text(),
    wabaId: text(),
    displayPhone: text(),
    /** `iv:tag:dados`, em base64url (ver core/secrets.ts) */
    accessTokenEnc: text(),
    /** confere a assinatura do aviso que a Meta manda; também cifrado */
    appSecretEnc: text(),
    /** o que a oficina cola no painel da Meta para provar que o endereço é dela */
    verifyToken: text(),
    connectedAt: timestamptz(),
    lastError: text(),
    ...timestamps,
  },
  (t) => [
    check('messaging_channels_provider_check', sql`${t.provider} in (${list(MESSAGING_PROVIDERS)})`),
    check('messaging_channels_status_check', sql`${t.status} in (${list(CHANNEL_STATUSES)})`),
    // o aviso da Meta chega sem oficina: é por este id que se descobre de quem é
    uniqueIndex('messaging_channels_phone_unique').on(t.phoneNumberId),
  ],
);

/**
 * O que a oficina informou sobre cada modelo na Meta, e se ele pode sair
 * sozinho. Linha ausente = modelo não submetido e envio manual, que é o
 * estado em que todo mundo começa.
 */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    key: text({ enum: MESSAGE_TEMPLATE_KEYS }).notNull(),
    status: text({ enum: TEMPLATE_STATUSES }).notNull().default('NOT_SUBMITTED'),
    /** o nome do modelo na Meta, quando diferente do nosso padrão */
    providerName: text(),
    /** sai sozinho? só vale para modelo de UTILIDADE, e por escolha da oficina */
    automatic: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('message_templates_org_key_unique').on(t.organizationId, t.key),
    check('message_templates_key_check', sql`${t.key} in (${list(MESSAGE_TEMPLATE_KEYS)})`),
    check('message_templates_status_check', sql`${t.status} in (${list(TEMPLATE_STATUSES)})`),
  ],
);

/**
 * A conversa com um cliente. Existe para a lista do chat abrir sem varrer o
 * histórico inteiro, e para guardar as duas coisas que a tela precisa saber
 * na hora: quantas mensagens não lidas e quando o cliente falou pela última
 * vez — é essa data que abre (ou fecha) a janela de 24 h da Meta.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    customerId: uuid().notNull(),
    lastMessageAt: timestamptz(),
    lastInboundAt: timestamptz(),
    lastPreview: text(),
    lastDirection: text(),
    unread: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('conversations_org_customer_unique').on(t.organizationId, t.customerId),
    index('conversations_recent_idx').on(t.organizationId, t.lastMessageAt.desc()),
    check('conversations_unread_check', sql`${t.unread} >= 0`),
  ],
);
