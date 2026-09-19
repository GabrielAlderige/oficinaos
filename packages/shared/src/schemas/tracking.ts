import { z } from 'zod';
import { WORK_ORDER_STATUSES } from '../enums/work-orders';

/**
 * "Acompanhe seu veículo" (E17). A página que o cliente abre para saber em que
 * pé está o carro, sem ligar para a oficina — e sem ver nada que não seja
 * dele: sem custo de peça, sem margem, sem observação interna.
 */

export const trackingStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** já aconteceu? */
  done: z.boolean(),
  /** é onde o carro está agora? */
  current: z.boolean(),
  at: z.string().nullable(),
});

export const publicTrackingSchema = z.object({
  shopName: z.string(),
  shopWhatsapp: z.string().nullable(),
  number: z.number().int(),
  status: z.enum(WORK_ORDER_STATUSES),
  statusLabel: z.string(),
  /** uma frase dizendo o que está acontecendo, escrita para o cliente */
  headline: z.string(),
  vehicleLabel: z.string(),
  openedAt: z.string(),
  promisedAt: z.string().nullable(),
  steps: z.array(trackingStepSchema),
  /** o que o cliente aprovou; null enquanto não houver orçamento aprovado */
  approvedTotalCents: z.number().int().nullable(),
  balanceCents: z.number().int().nullable(),
});

export const trackingLinkResultSchema = z.object({
  publicUrl: z.string(),
  message: z.string(),
  whatsappUrl: z.string().nullable(),
});

export type PublicTracking = z.infer<typeof publicTrackingSchema>;
export type TrackingStep = z.infer<typeof trackingStepSchema>;
export type TrackingLinkResult = z.infer<typeof trackingLinkResultSchema>;
