import { z } from 'zod';
import { PAYMENT_METHODS } from './enums/payments';
import { lineGrossCents } from './pricing';
import { parseQuantity } from './quantity';
import { quantitySchema } from './schemas/catalog';
import { optionalText } from './schemas/common';

/**
 * Venda de balcão (E49): a peça vendida sem ordem de serviço — o cliente
 * passa, leva um óleo, uma lâmpada, um jogo de palhetas e vai embora.
 *
 * Três coisas acontecem juntas, ou nenhuma: a peça sai do estoque, a venda
 * vira conta a receber no financeiro e, se o cliente pagou na hora, a conta já
 * nasce quitada. Cancelar desfaz as três.
 */

export const COUNTER_SALE_STATUSES = ['COMPLETED', 'CANCELED'] as const;
export type CounterSaleStatus = (typeof COUNTER_SALE_STATUSES)[number];
export const COUNTER_SALE_STATUS_LABELS: Record<CounterSaleStatus, string> = {
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
};

export interface CounterSaleLine {
  quantityMilli: number;
  unitPriceCents: number;
}

export interface CounterSaleTotals {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * Subtotal das linhas, desconto que nunca passa do subtotal, e o total. A
 * mesma conta da OS (`lineGrossCents`, meio para cima, sem float), para a
 * mesma peça custar o mesmo no balcão e na OS.
 */
export function counterSaleTotals(lines: CounterSaleLine[], discountCents: number): CounterSaleTotals {
  const subtotalCents = lines.reduce((soma, linha) => soma + lineGrossCents(linha.quantityMilli, linha.unitPriceCents), 0);
  const desconto = Math.min(Math.max(0, discountCents), subtotalCents);
  return { subtotalCents, discountCents: desconto, totalCents: subtotalCents - desconto };
}

const cents = z.number().int().min(0).max(100_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const counterSaleItemInputSchema = z
  .object({
    /** peça do catálogo (sai do estoque); sem ela, é um item avulso com descrição */
    partId: z.uuid().nullable().default(null),
    description: optionalText(200).default(''),
    quantity: quantitySchema.refine((v) => v > 0, 'A quantidade precisa ser maior que zero'),
    unitPriceCents: cents,
  })
  .refine((item) => item.partId !== null || item.description.length >= 2, {
    message: 'Escolha uma peça ou escreva o que foi vendido',
    path: ['description'],
  });

export const COUNTER_SALE_PAYMENT_KINDS = ['PAID', 'LATER', 'POS'] as const;

export const createCounterSaleSchema = z
  .object({
    /** gerado pela tela: clique duplo, ou rede que repete o POST, não vende duas vezes */
    clientRequestId: z.uuid(),
    customerId: z.uuid().nullable().default(null),
    items: z.array(counterSaleItemInputSchema).min(1, 'Adicione pelo menos um item').max(50, 'No máximo 50 itens'),
    discountCents: cents.default(0),
    payment: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('PAID'), method: z.enum(PAYMENT_METHODS) }),
      /** fiado: vira conta a receber com vencimento */
      z.object({ kind: z.literal('LATER'), dueDate: isoDate }),
      /** na maquininha (E50): a conta nasce em aberto e a maquininha dá a baixa quando o cartão passar */
      z.object({ kind: z.literal('POS') }),
    ]),
    notes: optionalText(500).default(''),
  })
  .refine((venda) => venda.payment.kind !== 'LATER' || venda.customerId !== null, {
    message: 'Para vender fiado, escolha o cliente: é dele que a oficina vai cobrar',
    path: ['customerId'],
  });
export type CreateCounterSaleInput = z.input<typeof createCounterSaleSchema>;

export const cancelCounterSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Diga o motivo do cancelamento').max(300),
});

export const counterSaleItemSchema = z.object({
  id: z.uuid(),
  partId: z.uuid().nullable(),
  description: z.string(),
  quantity: z.number(),
  unitPriceCents: z.number().int(),
  totalCents: z.number().int(),
});

export const counterSaleSchema = z.object({
  id: z.uuid(),
  number: z.number().int(),
  status: z.enum(COUNTER_SALE_STATUSES),
  customerId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  subtotalCents: z.number().int(),
  discountCents: z.number().int(),
  totalCents: z.number().int(),
  /** quanto já entrou: igual ao total quando foi pago na hora */
  paidCents: z.number().int(),
  financialEntryId: z.uuid().nullable(),
  notes: z.string().nullable(),
  soldAt: z.string(),
  soldByName: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  items: z.array(counterSaleItemSchema),
  /** peças que ficaram com saldo negativo: a oficina precisa acertar a contagem */
  negativeStock: z.array(z.object({ partId: z.uuid(), name: z.string() })).default([]),
});
export type CounterSale = z.infer<typeof counterSaleSchema>;

export const counterSaleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** quantidade da tela (4,5) → milésimos; a validação já garantiu as 3 casas */
export const quantityMilliOf = (value: number) => parseQuantity(value) ?? 0;
