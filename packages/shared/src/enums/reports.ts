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
];

export const REPORT_BY_KEY: Record<ReportKey, ReportInfo> = Object.fromEntries(
  REPORTS.map((relatorio) => [relatorio.key, relatorio]),
) as Record<ReportKey, ReportInfo>;

/**
 * Pacotes de relatório (E44): vários relatórios num documento só.
 *
 * Existem porque ninguém manda nove anexos para o contador. O dono quer "o
 * financeiro do mês" ou "o geral do trimestre" — um arquivo, com as seções na
 * ordem em que ele lê. Cada pacote é só uma LISTA dos relatórios que já
 * existem: nenhuma consulta nova, nenhum número novo que possa divergir do que
 * a tela mostra.
 */
export const REPORT_PACK_KEYS = ['financeiro', 'estoque', 'operacao', 'clientes', 'geral'] as const;
export type ReportPackKey = (typeof REPORT_PACK_KEYS)[number];

export interface ReportPackInfo {
  key: ReportPackKey;
  title: string;
  question: string;
  sections: readonly ReportKey[];
}

export const REPORT_PACKS: readonly ReportPackInfo[] = [
  {
    key: 'financeiro',
    title: 'Financeiro completo',
    question: 'Quanto entrou, o que sobrou e de onde veio — o que o contador pede.',
    sections: ['revenue', 'profit', 'approval'],
  },
  {
    key: 'estoque',
    title: 'Estoque',
    question: 'Quanto há de dinheiro parado, o que falta e o que mais saiu.',
    sections: ['inventory', 'parts'],
  },
  {
    key: 'operacao',
    title: 'Operação',
    question: 'O que a oficina executou, quem entregou e se o orçamento virou serviço.',
    sections: ['services', 'mechanics', 'approval'],
  },
  {
    key: 'clientes',
    title: 'Clientes e veículos',
    question: 'Quem gasta, quem voltou e que carros a oficina atende.',
    sections: ['customers', 'vehicles'],
  },
  {
    key: 'geral',
    title: 'Geral',
    question: 'Tudo o que a oficina produziu no período, seção por seção.',
    sections: ['revenue', 'profit', 'services', 'parts', 'inventory', 'mechanics', 'approval', 'customers', 'vehicles'],
  },
];

export const REPORT_PACK_BY_KEY: Record<ReportPackKey, ReportPackInfo> = Object.fromEntries(
  REPORT_PACKS.map((pacote) => [pacote.key, pacote]),
) as Record<ReportPackKey, ReportPackInfo>;

/** Como a célula é lida: dinheiro, número, texto, data, porcentagem, duração. */
export const REPORT_COLUMN_FORMATS = ['text', 'money', 'number', 'quantity', 'percent', 'date', 'minutes'] as const;
export type ReportColumnFormat = (typeof REPORT_COLUMN_FORMATS)[number];
