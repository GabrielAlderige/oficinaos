/**
 * Financeiro (docs/DATABASE.md §6, MVP 2, E13). Contas a receber e a pagar
 * vivem na MESMA tabela, separadas por `direction`: o ciclo de vida é idêntico
 * (vence, recebe baixa, quita) e o fluxo de caixa sai de uma consulta só.
 */

export const FINANCIAL_DIRECTIONS = ['RECEIVABLE', 'PAYABLE'] as const;
export type FinancialDirection = (typeof FINANCIAL_DIRECTIONS)[number];

export const FINANCIAL_DIRECTION_LABELS: Record<FinancialDirection, string> = {
  RECEIVABLE: 'A receber',
  PAYABLE: 'A pagar',
};

/**
 * Situação GRAVADA. "Vencida" não está aqui de propósito: é a data de hoje
 * comparada com o vencimento, e guardar isso exigiria um job varrendo a tabela
 * toda madrugada só para o número da tela ficar certo. Mesma escolha da
 * cotação vencida (E11).
 */
export const FINANCIAL_ENTRY_STATUSES = ['OPEN', 'PARTIAL', 'PAID', 'CANCELED'] as const;
export type FinancialEntryStatus = (typeof FINANCIAL_ENTRY_STATUSES)[number];

/** O que a tela mostra: a situação gravada, com "vencida" calculada por cima. */
export const FINANCIAL_SITUATIONS = ['OPEN', 'PARTIAL', 'OVERDUE', 'PAID', 'CANCELED'] as const;
export type FinancialSituation = (typeof FINANCIAL_SITUATIONS)[number];

export const FINANCIAL_SITUATION_LABELS: Record<FinancialSituation, string> = {
  OPEN: 'Em aberto',
  PARTIAL: 'Parcial',
  OVERDUE: 'Vencida',
  PAID: 'Quitada',
  CANCELED: 'Cancelada',
};

export const FINANCIAL_SITUATION_TONES = {
  OPEN: 'neutral',
  PARTIAL: 'info',
  OVERDUE: 'danger',
  PAID: 'success',
  CANCELED: 'warning',
} as const satisfies Record<FinancialSituation, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/**
 * Categorias que nascem com a oficina. `key` identifica a categoria no código
 * (o nome a oficina pode renomear); `PARTS` é especial no lucro estimado, ver
 * `lucroEstimado` em `finance.ts`.
 */
export const SYSTEM_FINANCIAL_CATEGORY_KEYS = [
  'SERVICES',
  'OTHER_INCOME',
  'PARTS',
  'PAYROLL',
  'RENT',
  'UTILITIES',
  'TAXES',
  'TOOLS',
  'OTHER_EXPENSE',
] as const;
export type SystemFinancialCategoryKey = (typeof SYSTEM_FINANCIAL_CATEGORY_KEYS)[number];

export interface SystemFinancialCategory {
  key: SystemFinancialCategoryKey;
  direction: FinancialDirection;
  name: string;
}

export const SYSTEM_FINANCIAL_CATEGORIES: readonly SystemFinancialCategory[] = [
  { key: 'SERVICES', direction: 'RECEIVABLE', name: 'Serviços e peças' },
  { key: 'OTHER_INCOME', direction: 'RECEIVABLE', name: 'Outras receitas' },
  { key: 'PARTS', direction: 'PAYABLE', name: 'Peças e insumos' },
  { key: 'PAYROLL', direction: 'PAYABLE', name: 'Salários e encargos' },
  { key: 'RENT', direction: 'PAYABLE', name: 'Aluguel' },
  { key: 'UTILITIES', direction: 'PAYABLE', name: 'Água, luz, internet' },
  { key: 'TAXES', direction: 'PAYABLE', name: 'Impostos e taxas' },
  { key: 'TOOLS', direction: 'PAYABLE', name: 'Ferramentas e manutenção' },
  { key: 'OTHER_EXPENSE', direction: 'PAYABLE', name: 'Outras despesas' },
];

/** De onde o lançamento veio. Automático não se apaga à toa: ele espelha a OS ou a compra. */
export const FINANCIAL_ORIGINS = ['MANUAL', 'WORK_ORDER', 'PURCHASE'] as const;
export type FinancialOrigin = (typeof FINANCIAL_ORIGINS)[number];

export const FINANCIAL_ORIGIN_LABELS: Record<FinancialOrigin, string> = {
  MANUAL: 'Lançamento manual',
  WORK_ORDER: 'Ordem de serviço',
  PURCHASE: 'Compra',
};

/** Agrupamento do fluxo de caixa. */
export const CASH_FLOW_STEPS = ['day', 'week', 'month'] as const;
export type CashFlowStep = (typeof CASH_FLOW_STEPS)[number];
