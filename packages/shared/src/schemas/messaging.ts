import { z } from 'zod';
import {
  CHANNEL_STATUSES,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGING_PROVIDERS,
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
} from '../enums/messaging';
import { MESSAGE_DIRECTIONS, MESSAGE_STATUSES } from '../enums/quotes';

// ------------------------------ o canal ------------------------------------

/**
 * O WhatsApp da oficina. O token **nunca** volta para a tela: a resposta traz
 * só os quatro últimos caracteres, para a pessoa conferir que colou o certo.
 */
export const messagingChannelSchema = z.object({
  provider: z.enum(MESSAGING_PROVIDERS),
  status: z.enum(CHANNEL_STATUSES),
  /** o número que aparece para o cliente, como a Meta mostra */
  displayPhone: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  wabaId: z.string().nullable(),
  tokenHint: z.string().nullable(),
  /** o endereço que a oficina cola no painel da Meta */
  webhookUrl: z.url().nullable(),
  verifyToken: z.string().nullable(),
  connectedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  /** envio automático, por modelo (só os de utilidade aparecem aqui) */
  autoSend: z.array(z.enum(MESSAGE_TEMPLATE_KEYS)),
});
export type MessagingChannel = z.infer<typeof messagingChannelSchema>;

export const connectChannelSchema = z.object({
  phoneNumberId: z.string().trim().min(3).max(64),
  wabaId: z.string().trim().max(64).optional(),
  accessToken: z.string().trim().min(20),
  /** conferido no aviso que a Meta manda; sem ele, aviso nenhum é aceito */
  appSecret: z.string().trim().min(8).max(128),
});
export type ConnectChannelInput = z.infer<typeof connectChannelSchema>;

export const updateAutoSendSchema = z.object({
  autoSend: z.array(z.enum(MESSAGE_TEMPLATE_KEYS)),
});
export type UpdateAutoSendInput = z.infer<typeof updateAutoSendSchema>;

// ----------------------------- os modelos ----------------------------------

export const messageTemplateSchema = z.object({
  key: z.enum(MESSAGE_TEMPLATE_KEYS),
  label: z.string(),
  descricao: z.string(),
  categoria: z.enum(TEMPLATE_CATEGORIES),
  podeSerAutomatica: z.boolean(),
  /** o evento que manda a mensagem sozinha; null = automático não é oferecido */
  gatilho: z.string().nullable(),
  variaveis: z.array(z.string()),
  /** o que a oficina informou sobre a aprovação na Meta */
  status: z.enum(TEMPLATE_STATUSES),
  /** o nome do modelo lá, quando diferente do nosso padrão */
  providerName: z.string().nullable(),
  automatica: z.boolean(),
  /** um exemplo com dados de verdade da oficina, para conferir antes de submeter */
  exemplo: z.string(),
});
export type MessageTemplateInfo = z.infer<typeof messageTemplateSchema>;

export const updateTemplateSchema = z.object({
  key: z.enum(MESSAGE_TEMPLATE_KEYS),
  status: z.enum(TEMPLATE_STATUSES).optional(),
  providerName: z.string().trim().max(120).nullable().optional(),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const messagingOverviewSchema = z.object({
  channel: messagingChannelSchema,
  templates: z.array(messageTemplateSchema),
});
export type MessagingOverview = z.infer<typeof messagingOverviewSchema>;

// ---------------------------- a conversa -----------------------------------

export const chatMessageSchema = z.object({
  id: z.uuid(),
  direction: z.enum(MESSAGE_DIRECTIONS),
  body: z.string(),
  status: z.enum(MESSAGE_STATUSES),
  templateKey: z.enum(MESSAGE_TEMPLATE_KEYS).nullable(),
  sentByName: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationSummarySchema = z.object({
  customerId: z.uuid(),
  customerName: z.string(),
  phone: z.string().nullable(),
  lastMessageAt: z.iso.datetime().nullable(),
  lastPreview: z.string().nullable(),
  lastDirection: z.enum(MESSAGE_DIRECTIONS).nullable(),
  unread: z.number().int(),
  /** a janela de 24 h ainda está aberta com este cliente? */
  windowOpen: z.boolean(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const conversationSchema = z.object({
  customerId: z.uuid(),
  customerName: z.string(),
  phone: z.string().nullable(),
  channelConnected: z.boolean(),
  /** o que dá para enviar agora, e por quê (janela de 24 h) */
  canSendFreeText: z.boolean(),
  onlyTemplate: z.boolean(),
  windowReason: z.string(),
  /** o link wa.me, que continua valendo quando não há canal conectado */
  whatsappUrl: z.url().nullable(),
  messages: z.array(chatMessageSchema),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const sendMessageSchema = z
  .object({
    /** texto livre: só com a janela aberta */
    body: z.string().trim().min(1).max(3000).optional(),
    /** ou um modelo do catálogo, que o servidor escreve com os dados da OS */
    templateKey: z.enum(MESSAGE_TEMPLATE_KEYS).optional(),
    workOrderId: z.uuid().optional(),
    /** rede ruim repete POST: o segundo não manda de novo (D32) */
    clientRequestId: z.uuid(),
  })
  .refine((valor) => Boolean(valor.body) !== Boolean(valor.templateKey), {
    message: 'Mande o texto ou escolha um modelo, não os dois',
  });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/** A prévia do modelo: o texto exato que vai sair, antes de alguém apertar. */
export const messagePreviewSchema = z.object({
  templateKey: z.enum(MESSAGE_TEMPLATE_KEYS),
  body: z.string(),
  /** por onde vai sair: pela API ou pelo link do WhatsApp */
  via: z.enum(MESSAGING_PROVIDERS),
  whatsappUrl: z.url().nullable(),
  /** o que impede o envio agora, se algo impedir */
  blocker: z.string().nullable(),
});
export type MessagePreview = z.infer<typeof messagePreviewSchema>;

/**
 * O que a tela recebe depois de apertar enviar. `whatsappUrl` vem preenchido
 * quando o envio foi pelo link (sem canal conectado): é a tela que abre o
 * WhatsApp. `repeated` diz que aquele POST já havia sido feito — rede ruim
 * repete, e a mensagem não sai duas vezes.
 */
/**
 * O que a tela de conversa oferece com um toque: os **modelos** (que valem
 * até fora da janela de 24 h, quando aprovados na Meta) e as **respostas
 * rápidas**, que só preenchem o campo de texto para a pessoa revisar e mandar.
 */
export const quickReplySchema = z.object({
  key: z.string(),
  grupo: z.string(),
  titulo: z.string(),
  body: z.string(),
});
export type QuickReply = z.infer<typeof quickReplySchema>;

export const conversationHelpersSchema = z.object({
  templates: z.array(messagePreviewSchema),
  quickReplies: z.array(quickReplySchema),
});
export type ConversationHelpers = z.infer<typeof conversationHelpersSchema>;

export const sendMessageResultSchema = z.object({
  conversation: conversationSchema,
  whatsappUrl: z.url().nullable(),
  via: z.enum(MESSAGING_PROVIDERS),
  repeated: z.boolean(),
});
export type SendMessageResult = z.infer<typeof sendMessageResultSchema>;
