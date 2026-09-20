import { z } from 'zod';
import { CHARGE_METHODS, CHARGE_STATUSES, PAYMENT_ENVIRONMENTS } from '../enums/charges';

export const chargeSchema = z.object({
  id: z.uuid(),
  method: z.enum(CHARGE_METHODS),
  status: z.enum(CHARGE_STATUSES),
  environment: z.enum(PAYMENT_ENVIRONMENTS),
  provider: z.string(),
  workOrderId: z.uuid(),
  workOrderNumber: z.number().int(),
  customerId: z.uuid(),
  customerName: z.string(),
  amountCents: z.number().int(),
  dueDate: z.iso.date(),
  description: z.string(),
  /** a página de pagamento do gateway (é para lá que o link do WhatsApp leva) */
  paymentUrl: z.url().nullable(),
  /** o "copia e cola" do Pix */
  pixPayload: z.string().nullable(),
  /** QR em PNG base64, como o gateway devolveu (sem gateway, fica vazio) */
  pixQrImage: z.string().nullable(),
  boletoUrl: z.url().nullable(),
  barcode: z.string().nullable(),
  paidAt: z.iso.datetime().nullable(),
  paidAmountCents: z.number().int().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  cancelReason: z.string().nullable(),
  refundedAt: z.iso.datetime().nullable(),
  failureReason: z.string().nullable(),
  /** o pagamento que a conciliação criou no caixa da OS */
  paymentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type Charge = z.infer<typeof chargeSchema>;

export const createChargeSchema = z.object({
  /** rede de oficina repete POST: o segundo devolve a mesma cobrança (D32) */
  clientRequestId: z.uuid(),
  method: z.enum(CHARGE_METHODS),
  amountCents: z.number().int().positive('O valor precisa ser maior que zero'),
  dueDate: z.iso.date().optional(),
  description: z.string().trim().max(255).optional(),
});
export type CreateChargeInput = z.infer<typeof createChargeSchema>;

export const cancelChargeSchema = z.object({
  reason: z.string().trim().min(5, 'Escreva o motivo do cancelamento').max(255),
});
export type CancelChargeInput = z.infer<typeof cancelChargeSchema>;

/** O que a tela da OS precisa para oferecer (ou não) uma cobrança nova. */
export const chargeSummarySchema = z.object({
  charges: z.array(chargeSchema),
  environment: z.enum(PAYMENT_ENVIRONMENTS),
  provider: z.string(),
  /** o que a OS ainda deve */
  balanceCents: z.number().int(),
  /** o que já está pendurado em cobrança aberta */
  pendingCents: z.number().int(),
  /** saldo menos o pendurado: o teto de uma cobrança nova */
  availableCents: z.number().int(),
  /** a mensagem pronta e o link do WhatsApp da última cobrança aberta */
  whatsappUrl: z.url().nullable(),
  message: z.string().nullable(),
});
export type ChargeSummary = z.infer<typeof chargeSummarySchema>;
