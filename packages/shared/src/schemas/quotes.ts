import { z } from 'zod';
import {
  APPROVAL_CHANNELS,
  APPROVAL_DECISIONS,
  DEFAULT_QUOTE_VALIDITY_DAYS,
  QUOTE_KINDS,
  QUOTE_STATUSES,
  SHARE_CHANNELS,
} from '../enums/quotes';
import { WORK_ORDER_ITEM_TYPES } from '../enums/work-orders';
import { optionalText } from './common';

const validityDays = z.number().int().min(1).max(90);

// ------------------------------- na oficina -------------------------------

/**
 * Enviar orçamento: congela os itens em rascunho da OS. `itemIds` vazio =
 * todos os que estiverem em rascunho (o caminho normal).
 */
export const createQuoteSchema = z.object({
  itemIds: z.array(z.uuid()).max(200).default([]),
  validityDays: validityDays.default(DEFAULT_QUOTE_VALIDITY_DAYS),
  /** aparece no topo da página do cliente, acima dos itens */
  message: optionalText(500).default(''),
});

export const shareQuoteSchema = z.object({
  channel: z.enum(SHARE_CHANNELS),
});

export const extendQuoteSchema = z.object({
  validityDays: validityDays.default(DEFAULT_QUOTE_VALIDITY_DAYS),
});

/**
 * Aprovação registrada pela equipe: o cliente disse "pode fazer" no telefone ou
 * no balcão. A auditoria guarda QUEM registrou — a responsabilidade é de quem
 * anotou, não do cliente.
 */
export const manualDecisionSchema = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    channel: z.enum(['PHONE', 'IN_PERSON', 'WHATSAPP'] as const),
    /** vazio em APPROVED = tudo; obrigatório em PARTIALLY_APPROVED */
    approvedItemIds: z.array(z.uuid()).max(200).default([]),
    signerName: optionalText(120).default(''),
    notes: optionalText(500).default(''),
  })
  .superRefine((value, ctx) => {
    if (value.decision === 'PARTIALLY_APPROVED' && value.approvedItemIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['approvedItemIds'], message: 'Escolha os itens aprovados' });
    }
  });

export const quoteListQuerySchema = z.object({
  status: z.enum([...QUOTE_STATUSES, 'open', 'all']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------------------------- página do cliente ----------------------------

/**
 * Aprovação pelo link. `contentHash` prova que o cliente aprovou ESTA versão;
 * `accepted` é o aceite explícito (nada de checkbox pré-marcado).
 */
export const publicApproveSchema = z.object({
  approvedItemIds: z.array(z.uuid()).max(200),
  signerName: z.string().trim().min(2, 'Digite seu nome').max(120),
  accepted: z.literal(true, { message: 'É preciso marcar o aceite' }),
  contentHash: z.string().min(16).max(128),
});

export const publicRejectSchema = z.object({
  reason: optionalText(500).default(''),
  contentHash: z.string().min(16).max(128),
});

export const publicQuestionSchema = z.object({
  message: z.string().trim().min(3, 'Escreva sua pergunta').max(1000),
});

// --------------------------------- saída ---------------------------------

export const quoteItemSchema = z.object({
  id: z.uuid(),
  /** null quando o item saiu da OS depois: o orçamento é cópia congelada */
  workOrderItemId: z.uuid().nullable(),
  type: z.enum(WORK_ORDER_ITEM_TYPES),
  description: z.string(),
  partCode: z.string().nullable(),
  brand: z.string().nullable(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  /** recomendado: o cliente pode desmarcar */
  isOptional: z.boolean(),
  position: z.number().int(),
  /** fotos daquele item ("identificamos este problema no seu veículo") */
  photos: z.array(z.object({ id: z.uuid(), url: z.string(), caption: z.string().nullable() })).default([]),
});

/** O que a oficina vê. */
export const quoteSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  workOrderId: z.uuid(),
  workOrderNumber: z.number().int(),
  version: z.number().int(),
  kind: z.enum(QUOTE_KINDS),
  status: z.enum(QUOTE_STATUSES),
  publicUrl: z.string(),
  validUntil: z.string(),
  message: z.string().nullable(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  surchargeCents: z.number().int(),
  totalCents: z.number().int(),
  approvedTotalCents: z.number().int().nullable(),
  sentAt: z.string(),
  sentByName: z.string().nullable(),
  firstViewedAt: z.string().nullable(),
  lastViewedAt: z.string().nullable(),
  viewCount: z.number().int(),
  decidedAt: z.string().nullable(),
  decision: z
    .object({
      decision: z.enum(APPROVAL_DECISIONS),
      channel: z.enum(APPROVAL_CHANNELS),
      signerName: z.string().nullable(),
      rejectionReason: z.string().nullable(),
      approvedItemIds: z.array(z.uuid()),
      recordedByName: z.string().nullable(),
      decidedAt: z.string(),
    })
    .nullable(),
  items: z.array(quoteItemSchema),
});

export const quoteListItemSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  workOrderId: z.uuid(),
  workOrderNumber: z.number().int(),
  status: z.enum(QUOTE_STATUSES),
  kind: z.enum(QUOTE_KINDS),
  customerName: z.string(),
  vehiclePlate: z.string().nullable(),
  vehicleName: z.string(),
  totalCents: z.number().int(),
  validUntil: z.string(),
  sentAt: z.string(),
  firstViewedAt: z.string().nullable(),
  viewCount: z.number().int(),
});

/**
 * O que o CLIENTE vê. Sem CPF, sem endereço, sem custo e sem margem
 * (ARCHITECTURE §8.2): o que não é necessário para decidir, não sai daqui.
 */
export const publicQuoteSchema = z.object({
  number: z.number().int(),
  kind: z.enum(QUOTE_KINDS),
  status: z.enum(QUOTE_STATUSES),
  validUntil: z.string(),
  message: z.string().nullable(),
  contentHash: z.string(),
  shop: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    whatsapp: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
  }),
  customerFirstName: z.string(),
  vehicle: z.object({
    make: z.string(),
    model: z.string(),
    version: z.string().nullable(),
    plate: z.string().nullable(),
    yearLabel: z.string().nullable(),
  }),
  items: z.array(quoteItemSchema.omit({ workOrderItemId: true })),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  surchargeCents: z.number().int(),
  totalCents: z.number().int(),
  /** já decidido: o que foi aprovado, para a página mostrar o resultado */
  decision: z
    .object({
      decision: z.enum(APPROVAL_DECISIONS),
      approvedItemIds: z.array(z.uuid()),
      approvedTotalCents: z.number().int(),
      signerName: z.string().nullable(),
      decidedAt: z.string(),
    })
    .nullable(),
});

/** Versão substituída: o link antigo leva à nova, sem o cliente pedir nada. */
export const publicQuoteRedirectSchema = z.object({ redirectToken: z.string() });

export type CreateQuoteInput = z.output<typeof createQuoteSchema>;
export type ManualDecisionInput = z.output<typeof manualDecisionSchema>;
export type PublicApproveInput = z.output<typeof publicApproveSchema>;
export type Quote = z.infer<typeof quoteSchema>;
export type QuoteItem = z.infer<typeof quoteItemSchema>;
export type QuoteListItem = z.infer<typeof quoteListItemSchema>;
export type PublicQuote = z.infer<typeof publicQuoteSchema>;
