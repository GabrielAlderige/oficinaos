import { z } from 'zod';
import { PAYMENT_ENTRY_STATUSES, PAYMENT_METHODS } from '../enums/payments';
import { optionalText } from './common';

/** Pagamento de valor zero não existe; o teto é o mesmo dos outros valores. */
const amount = z.number().int().min(1, 'O valor precisa ser maior que zero').max(100_000_000);

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida');

/**
 * Registro do que a oficina JÁ recebeu. Aceito a partir da aprovação (sinal e
 * adiantamento são comuns) e também depois da entrega, porque o fiado existe.
 */
export const recordPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountCents: amount,
  /** só registro: parcelamento de cartão não gera cobrança no MVP 1 */
  installments: z.number().int().min(1).max(36).default(1),
  /** quando o dinheiro entrou; nulo = agora */
  paidAt: isoDateTime.nullable().default(null),
  notes: optionalText(500).default(''),
  /**
   * Gerado pela tela (E13): clique duplo, ou rede que repete o POST, não
   * registra o pagamento duas vezes. Nulo = sem proteção (chamadas antigas).
   */
  clientRequestId: z.uuid().nullable().default(null),
});

/** Cancelar exige motivo: o lançamento fica no histórico, marcado. */
export const cancelPaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(200),
});

export const paymentSchema = z.object({
  id: z.uuid(),
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int(),
  installments: z.number().int(),
  status: z.enum(PAYMENT_ENTRY_STATUSES),
  paidAt: z.string(),
  notes: z.string().nullable(),
  /** o gateway, quando o dinheiro veio de cobrança online (E19) */
  provider: z.string().nullable(),
  recordedByName: z.string().nullable(),
  canceledAt: z.string().nullable(),
  canceledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
});

/**
 * A lista vem com o que a tela precisa para decidir: quanto já entrou e quanto
 * falta. Os dois são calculados pela API a partir dos lançamentos confirmados —
 * a tela nunca soma dinheiro por conta própria.
 */
export const paymentListSchema = z.object({
  data: z.array(paymentSchema),
  paidCents: z.number().int(),
  /** total aprovado da OS menos o pago; nunca negativo */
  balanceCents: z.number().int(),
});

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type CancelPaymentInput = z.output<typeof cancelPaymentSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type PaymentList = z.infer<typeof paymentListSchema>;
