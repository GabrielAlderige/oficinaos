import { z } from 'zod';
import {
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_TYPES,
  LEAD_SOURCES,
  LEAD_STAGES,
  REVIEW_MAX,
  REVIEW_MIN,
} from '../enums/aftersales';
import { optionalPhoneSchema, optionalText, personNameSchema } from './common';

/** Pós-venda, avaliações e CRM (E16). */

const cents = z.number().int().min(0).max(100_000_000);

// ------------------------------- pós-venda -------------------------------

export const followUpListQuerySchema = z.object({
  /** `today` traz o que vence hoje e o que ficou para trás: é a fila do dia */
  filter: z.enum(['today', 'week', 'done', 'all']).default('today'),
  type: z.enum(FOLLOW_UP_TYPES).optional(),
});

export const followUpSchema = z.object({
  id: z.uuid(),
  type: z.enum(FOLLOW_UP_TYPES),
  status: z.enum(FOLLOW_UP_STATUSES),
  dueOn: z.string(),
  /** dias de atraso na fila (0 = vence hoje ou depois) */
  lateDays: z.number().int(),
  reason: z.string().nullable(),
  customerId: z.uuid(),
  customerName: z.string(),
  customerWhatsapp: z.string().nullable(),
  vehicleId: z.uuid().nullable(),
  vehicleLabel: z.string().nullable(),
  workOrderId: z.uuid().nullable(),
  workOrderNumber: z.number().int().nullable(),
  /** a mensagem pronta e o link do WhatsApp: um toque e está enviado */
  message: z.string(),
  whatsappUrl: z.string().nullable(),
  doneAt: z.string().nullable(),
  outcome: z.string().nullable(),
});

export const followUpListSchema = z.object({
  data: z.array(followUpSchema),
  counts: z.object({ today: z.number().int(), late: z.number().int(), week: z.number().int() }),
});

export const followUpDoneSchema = z.object({ outcome: optionalText(200).default('') });

// ------------------------------- avaliações -------------------------------

export const reviewInviteResultSchema = z.object({
  reviewId: z.uuid(),
  publicUrl: z.string(),
  message: z.string(),
  whatsappUrl: z.string().nullable(),
});

export const publicReviewSchema = z.object({
  shopName: z.string(),
  /** já avaliada? a página vira "obrigado" */
  submitted: z.boolean(),
  rating: z.number().int().nullable(),
  comment: z.string().nullable(),
  vehicleLabel: z.string().nullable(),
  workOrderNumber: z.number().int(),
  /** para onde mandar quem quiser avaliar no Google (a oficina configura) */
  googleReviewUrl: z.string().nullable(),
});

export const submitReviewSchema = z.object({
  rating: z.number().int().min(REVIEW_MIN, 'Escolha de 1 a 5 estrelas').max(REVIEW_MAX),
  comment: optionalText(1000).default(''),
});

export const reviewSummarySchema = z.object({
  average: z.number(),
  total: z.number().int(),
  /** quantas de cada nota, de 1 a 5 */
  distribution: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
  pending: z.number().int(),
  latest: z.array(
    z.object({
      id: z.uuid(),
      rating: z.number().int(),
      comment: z.string().nullable(),
      customerName: z.string(),
      workOrderNumber: z.number().int(),
      submittedAt: z.string(),
    }),
  ),
});

// ---------------------------------- CRM ----------------------------------

export const leadFormSchema = z.object({
  name: personNameSchema,
  phone: optionalPhoneSchema.default(''),
  source: z.enum(LEAD_SOURCES).default('OTHER'),
  vehicleDesc: optionalText(120).default(''),
  need: optionalText(300).default(''),
  estimatedValueCents: cents.default(0),
  notes: optionalText(1000).default(''),
});

export const updateLeadSchema = leadFormSchema.partial();

export const moveLeadSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  /** obrigatório ao perder: sem motivo, o funil não ensina nada */
  lostReason: optionalText(200).default(''),
});

/** Fechar o lead: vira cliente de verdade (e, se quiser, uma OS depois). */
export const convertLeadSchema = z.object({
  /** vazio = cria um cliente novo com o nome e o telefone do lead */
  customerId: z.uuid().nullable().default(null),
});

export const leadSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  stage: z.enum(LEAD_STAGES),
  source: z.enum(LEAD_SOURCES),
  vehicleDesc: z.string().nullable(),
  need: z.string().nullable(),
  estimatedValueCents: z.number().int(),
  notes: z.string().nullable(),
  lostReason: z.string().nullable(),
  customerId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  whatsappUrl: z.string().nullable(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
  /** dias parado nesta etapa: é o que mostra o lead esquecido */
  idleDays: z.number().int(),
});

export const pipelineSchema = z.object({
  stages: z.array(
    z.object({
      stage: z.enum(LEAD_STAGES),
      count: z.number().int(),
      valueCents: z.number().int(),
      leads: z.array(leadSchema),
    }),
  ),
  openValueCents: z.number().int(),
  conversionBps: z.number().int(),
});

export type FollowUpListQuery = z.output<typeof followUpListQuerySchema>;
export type FollowUp = z.infer<typeof followUpSchema>;
export type FollowUpList = z.infer<typeof followUpListSchema>;
export type ReviewInviteResult = z.infer<typeof reviewInviteResultSchema>;
export type PublicReview = z.infer<typeof publicReviewSchema>;
export type SubmitReviewInput = z.output<typeof submitReviewSchema>;
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;
export type LeadForm = z.input<typeof leadFormSchema>;
export type LeadInput = z.output<typeof leadFormSchema>;
export type MoveLeadInput = z.output<typeof moveLeadSchema>;
export type Lead = z.infer<typeof leadSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;
