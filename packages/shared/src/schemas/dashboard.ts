import { z } from 'zod';
import { DASHBOARD_PERIODS } from '../calendar';
import { WORK_ORDER_STATUSES } from '../enums/work-orders';

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const dashboardQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('month'),
  /** só em `custom`; ausentes, o período vira "hoje" */
  from: dayKey.optional(),
  to: dayKey.optional(),
});

/**
 * Valor em dinheiro que **pode não vir**: quem não tem `dashboard:view_financial`
 * recebe `null`, e não zero. Zero seria mentira — o mecânico veria "faturamento
 * R$ 0,00" e acharia que a oficina não vendeu nada.
 */
const money = z.number().int().nullable();

export const periodInfoSchema = z.object({
  period: z.enum(DASHBOARD_PERIODS),
  from: dayKey,
  to: dayKey,
  /** "1 a 30 de setembro", já escrito no calendário da oficina */
  label: z.string(),
});

export const dashboardSummarySchema = z.object({
  period: periodInfoSchema,
  /**
   * Duas leituras de faturamento, de propósito: **faturado** é o que a oficina
   * entregou de serviço no período (OS finalizadas), **recebido** é o dinheiro
   * que entrou. Com fiado, os dois nunca batem, e misturar esconde o problema.
   */
  billedCents: money,
  receivedCents: money,
  avgTicketCents: money,
  /** situação do pátio, agora — independe do período escolhido */
  openByStatus: z.array(z.object({ status: z.enum(WORK_ORDER_STATUSES), count: z.number().int() })),
  awaitingApproval: z.number().int(),
  vehiclesInShop: z.number().int(),
  appointmentsToday: z.number().int(),
  /** no período */
  completedOrders: z.number().int(),
  completedServices: z.number().int(),
  vehiclesServed: z.number().int(),
  newCustomers: z.number().int(),
  approval: z.object({
    /** orçamentos que receberam resposta no período */
    answered: z.number().int(),
    approved: z.number().int(),
    pending: z.number().int(),
    offeredCents: money,
    approvedCents: money,
  }),
  topServices: z.array(z.object({ name: z.string(), count: z.number() })),
  topParts: z.array(z.object({ name: z.string(), quantity: z.number() })),
});

// -------------------------- atenção necessária ----------------------------

/**
 * O que está travado ou escapando, na ordem em que a oficina perde dinheiro com
 * isso. Cada grupo sabe para onde levar — o painel não mostra problema sem
 * caminho de solução.
 */
export const ATTENTION_KEYS = [
  'QUOTES_WAITING',
  'QUOTES_UNSEEN',
  'PROMISED_LATE',
  'COMPLETED_NOT_DELIVERED',
  'DELIVERED_UNPAID',
  /** contas a pagar vencidas (E13): o que o financeiro deixou passar */
  'BILLS_OVERDUE',
  'STOCK',
  'APPOINTMENTS_UNCONFIRMED',
] as const;
export type AttentionKey = (typeof ATTENTION_KEYS)[number];

export const attentionItemSchema = z.object({
  id: z.string(),
  /** "OS 182 · Gol ABC1D34" */
  label: z.string(),
  /** "aguardando há 3 dias" */
  detail: z.string(),
  /** caminho no painel: /ordens/182 */
  to: z.string(),
});

export const attentionGroupSchema = z.object({
  key: z.enum(ATTENTION_KEYS),
  title: z.string(),
  tone: z.enum(['warning', 'danger', 'info']),
  count: z.number().int(),
  /** os primeiros; `count` é o total */
  items: z.array(attentionItemSchema),
  /** para onde vai o "ver todos" */
  to: z.string().nullable(),
});

export const dashboardAttentionSchema = z.object({ groups: z.array(attentionGroupSchema) });

// -------------------------------- gráficos --------------------------------

export const CHART_METRICS = ['revenue', 'work_orders', 'avg_ticket', 'approval_rate', 'new_customers'] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

export const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  revenue: 'Faturamento',
  work_orders: 'Ordens de serviço',
  avg_ticket: 'Ticket médio',
  approval_rate: 'Taxa de aprovação',
  new_customers: 'Novos clientes',
};

export const chartQuerySchema = dashboardQuerySchema.extend({
  metric: z.enum(CHART_METRICS).default('revenue'),
});

export const dashboardChartSchema = z.object({
  metric: z.enum(CHART_METRICS),
  /** como ler o valor: centavos, contagem ou porcentagem */
  unit: z.enum(['money', 'count', 'percent']),
  period: periodInfoSchema,
  points: z.array(z.object({ day: dayKey, value: z.number() })),
});

export type DashboardQuery = z.output<typeof dashboardQuerySchema>;
export type ChartQuery = z.output<typeof chartQuerySchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type DashboardAttention = z.infer<typeof dashboardAttentionSchema>;
export type AttentionGroup = z.infer<typeof attentionGroupSchema>;
export type DashboardChart = z.infer<typeof dashboardChartSchema>;
export type PeriodInfo = z.infer<typeof periodInfoSchema>;
