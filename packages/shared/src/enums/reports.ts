/**
 * Relatórios (MVP 2, E15). Cada um responde a UMA pergunta que o dono faz de
 * verdade — "quanto entrou", "o que dá lucro", "quem não volta", "quem produz"
 * — e todos saem também em CSV, porque o contador pede planilha.
 */

export const REPORT_KEYS = [
  'revenue',
  'profit',
  'services',
  'parts',
  'customers',
  'vehicles',
  'mechanics',
  'approval',
  'inventory',
  'suppliers',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportInfo {
  key: ReportKey;
  title: string;
  question: string;
  /** relatório de estoque olha o AGORA; os outros, um período */
  snapshot?: boolean;
}

export const REPORTS: readonly ReportInfo[] = [
  { key: 'revenue', title: 'Faturamento', question: 'Quanto a oficina faturou, dia a dia, e qual o ticket médio?' },
  { key: 'profit', title: 'Lucro estimado', question: 'O que sobrou depois das peças e das despesas pagas?' },
  { key: 'services', title: 'Serviços', question: 'Quais serviços a oficina mais faz, e quanto cada um rende?' },
  { key: 'parts', title: 'Peças', question: 'Quais peças mais saem, quanto custaram e quanto renderam?' },
  { key: 'customers', title: 'Clientes', question: 'Quem gasta mais, quantas vezes voltou e quando foi a última?' },
  { key: 'vehicles', title: 'Veículos', question: 'Que carros a oficina atende, e quanto cada um já rendeu?' },
  { key: 'mechanics', title: 'Mecânicos', question: 'Quem entregou quanto, e o tempo real bateu com o estimado?' },
  { key: 'approval', title: 'Aprovação de orçamentos', question: 'Quantos orçamentos viram serviço — em quantidade e em valor?' },
  { key: 'inventory', title: 'Estoque', question: 'Quanto há de dinheiro parado na prateleira, e o que está faltando?', snapshot: true },
  { key: 'suppliers', title: 'Fornecedores', question: 'Quanto foi comprado de cada um, e eles entregam no prazo?' },
];

export const REPORT_BY_KEY: Record<ReportKey, ReportInfo> = Object.fromEntries(
  REPORTS.map((relatorio) => [relatorio.key, relatorio]),
) as Record<ReportKey, ReportInfo>;

/** Como a célula é lida: dinheiro, número, texto, data, porcentagem, duração. */
export const REPORT_COLUMN_FORMATS = ['text', 'money', 'number', 'quantity', 'percent', 'date', 'minutes'] as const;
export type ReportColumnFormat = (typeof REPORT_COLUMN_FORMATS)[number];
