import { z } from 'zod';
import { CASH_FLOW_STEPS, FINANCIAL_DIRECTIONS, FINANCIAL_ENTRY_STATUSES, FINANCIAL_ORIGINS, FINANCIAL_SITUATIONS } from '../enums/finance';
import { PAYMENT_METHODS } from '../enums/payments';
import { DASHBOARD_PERIODS } from '../calendar';
import { optionalText } from './common';

/**
 * Financeiro (E13): contas a receber, contas a pagar, baixa, fluxo de caixa e
 * lucro estimado. Dinheiro em centavos; vencimento é DATA (sem hora e sem
 * fuso) — "vence dia 10" não muda porque o servidor está em outro fuso.
 */

const money = z.number().int().min(1, 'O valor precisa ser maior que zero').max(100_000_000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida');

// ------------------------------- categorias -------------------------------

export const financialCategoryFormSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(60, 'Use no máximo 60 caracteres'),
  direction: z.enum(FINANCIAL_DIRECTIONS),
});

export const financialCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  direction: z.enum(FINANCIAL_DIRECTIONS),
  /** categoria que nasceu com a oficina: dá para renomear, não para apagar */
  systemKey: z.string().nullable(),
  entryCount: z.number().int(),
});

export const financialCategoryListSchema = z.object({ data: z.array(financialCategorySchema) });

// ------------------------------- lançamento -------------------------------

/**
 * Lançamento manual. O que nasce da OS (a receber) e da compra (a pagar) é
 * criado pela própria API — a tela não inventa conta ligada a documento.
 */
export const createFinancialEntrySchema = z.object({
  direction: z.enum(FINANCIAL_DIRECTIONS),
  categoryId: z.uuid('Escolha uma categoria'),
  description: z.string().trim().min(2, 'Descreva o lançamento').max(200),
  amountCents: money,
  dueDate: isoDate,
  /** de quem se recebe, ou para quem se paga (opcional: conta de luz não tem cliente) */
  customerId: z.uuid().nullable().default(null),
  supplierId: z.uuid().nullable().default(null),
  notes: optionalText(1000).default(''),
  /** parcelar já na criação: 3 parcelas mensais a partir do vencimento */
  installments: z.number().int().min(1, 'No mínimo uma parcela').max(48, 'No máximo 48 parcelas').default(1),
});

/** Edição: sem padrões, para nunca apagar um campo que não foi enviado. */
export const updateFinancialEntrySchema = z
  .object({
    categoryId: z.uuid(),
    description: z.string().trim().min(2, 'Descreva o lançamento').max(200),
    amountCents: money,
    dueDate: isoDate,
    customerId: z.uuid().nullable(),
    supplierId: z.uuid().nullable(),
    notes: optionalText(1000),
  })
  .partial();

export const cancelFinancialEntrySchema = z.object({
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento').max(200),
});

/** Parcelar um lançamento que ainda não recebeu baixa nenhuma. */
export const splitFinancialEntrySchema = z.object({
  installments: z.number().int().min(2, 'Parcelar é em duas ou mais').max(48),
  firstDueDate: isoDate.nullable().default(null),
});

/**
 * A baixa: o dinheiro que entrou (ou saiu) por causa deste lançamento.
 * `clientRequestId` é gerado pela tela — clique duplo não dá baixa duas vezes.
 */
export const settleFinancialEntrySchema = z.object({
  clientRequestId: z.uuid(),
  amountCents: money,
  method: z.enum(PAYMENT_METHODS),
  paidAt: isoDateTime.nullable().default(null),
  notes: optionalText(500).default(''),
});

export const cancelSettlementSchema = cancelFinancialEntrySchema;

// -------------------------------- consultas --------------------------------

/** O filtro da tela: o que interessa é "o que está em aberto" e "o que venceu". */
export const FINANCIAL_LIST_FILTERS = ['open', 'overdue', 'due_soon', 'paid', 'canceled', 'all'] as const;
export type FinancialListFilter = (typeof FINANCIAL_LIST_FILTERS)[number];

export const financialListQuerySchema = z.object({
  direction: z.enum(FINANCIAL_DIRECTIONS),
  filter: z.enum(FINANCIAL_LIST_FILTERS).default('open'),
  q: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const financialPeriodQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('month'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  step: z.enum(CASH_FLOW_STEPS).default('day'),
});

// --------------------------------- saídas ---------------------------------

export const financialSettlementSchema = z.object({
  id: z.uuid(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  paidAt: z.string(),
  notes: z.string().nullable(),
  status: z.enum(['CONFIRMED', 'CANCELED']),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  recordedByName: z.string().nullable(),
  /** a baixa de uma OS é o próprio pagamento do caixa (E7), não um lançamento novo */
  paymentId: z.uuid().nullable(),
});

export const financialEntrySchema = z.object({
  id: z.uuid(),
  direction: z.enum(FINANCIAL_DIRECTIONS),
  status: z.enum(FINANCIAL_ENTRY_STATUSES),
  /** a situação com "vencida" já resolvida pelo dia de hoje na oficina */
  situation: z.enum(FINANCIAL_SITUATIONS),
  overdueDays: z.number().int(),
  origin: z.enum(FINANCIAL_ORIGINS),
  description: z.string(),
  amountCents: z.number().int(),
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  dueDate: z.string(),
  categoryId: z.uuid().nullable(),
  categoryName: z.string().nullable(),
  customerId: z.uuid().nullable(),
  customerName: z.string().nullable(),
  supplierId: z.uuid().nullable(),
  supplierName: z.string().nullable(),
  workOrderId: z.uuid().nullable(),
  workOrderNumber: z.number().int().nullable(),
  purchaseOrderId: z.uuid().nullable(),
  purchaseOrderNumber: z.number().int().nullable(),
  installmentNumber: z.number().int(),
  installmentCount: z.number().int(),
  notes: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdAt: z.string(),
});

export const financialEntryDetailSchema = financialEntrySchema.extend({
  settlements: z.array(financialSettlementSchema),
});

/** O resumo que fica no topo da lista: é a pergunta do dia, não enfeite. */
export const financialSummarySchema = z.object({
  openCents: z.number().int(),
  overdueCents: z.number().int(),
  overdueCount: z.number().int(),
  dueTodayCents: z.number().int(),
  dueThisWeekCents: z.number().int(),
  settledThisMonthCents: z.number().int(),
});

export const financialListSchema = z.object({
  data: z.array(financialEntrySchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
  summary: financialSummarySchema,
});

export const cashFlowBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  inCents: z.number().int(),
  outCents: z.number().int(),
  netCents: z.number().int(),
  /** saldo acumulado dentro do período mostrado (não é saldo bancário) */
  runningCents: z.number().int(),
});

export const cashFlowSchema = z.object({
  from: z.string(),
  to: z.string(),
  step: z.enum(CASH_FLOW_STEPS),
  buckets: z.array(cashFlowBucketSchema),
  inCents: z.number().int(),
  outCents: z.number().int(),
  netCents: z.number().int(),
  /** o que ainda vai entrar e sair (em aberto), para a oficina enxergar o mês */
  expectedInCents: z.number().int(),
  expectedOutCents: z.number().int(),
});

export const profitSchema = z.object({
  from: z.string(),
  to: z.string(),
  receitaCents: z.number().int(),
  custoPecasCents: z.number().int(),
  despesasCents: z.number().int(),
  lucroCents: z.number().int(),
  margemBps: z.number().int(),
  despesasPorCategoria: z.array(z.object({ name: z.string(), amountCents: z.number().int() })),
});

export type FinancialCategoryForm = z.input<typeof financialCategoryFormSchema>;
export type FinancialCategory = z.infer<typeof financialCategorySchema>;
export type CreateFinancialEntryInput = z.output<typeof createFinancialEntrySchema>;
export type UpdateFinancialEntryInput = z.output<typeof updateFinancialEntrySchema>;
export type SettleFinancialEntryInput = z.output<typeof settleFinancialEntrySchema>;
export type SplitFinancialEntryInput = z.output<typeof splitFinancialEntrySchema>;
export type FinancialListQuery = z.output<typeof financialListQuerySchema>;
export type FinancialPeriodQuery = z.output<typeof financialPeriodQuerySchema>;
export type FinancialEntry = z.infer<typeof financialEntrySchema>;
export type FinancialEntryDetail = z.infer<typeof financialEntryDetailSchema>;
export type FinancialSettlement = z.infer<typeof financialSettlementSchema>;
export type FinancialSummary = z.infer<typeof financialSummarySchema>;
export type FinancialList = z.infer<typeof financialListSchema>;
export type CashFlow = z.infer<typeof cashFlowSchema>;
export type CashFlowBucket = z.infer<typeof cashFlowBucketSchema>;
export type ProfitReport = z.infer<typeof profitSchema>;
