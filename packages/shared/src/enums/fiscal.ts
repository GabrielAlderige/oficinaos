/**
 * Nota fiscal (V3, E18). Começa pela **NFS-e**: a nota de SERVIÇO, municipal,
 * que é o que trava a venda para a maioria das oficinas. A nota de peça
 * (NF-e/NFC-e, estadual) é etapa própria — ela exige NCM, CFOP e CST em todo o
 * catálogo, e nem toda oficina precisa.
 */

export const INVOICE_KINDS = ['NFSE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  NFSE: 'Nota de serviço (NFS-e)',
};

/**
 * Situação da nota. `QUEUED` existe porque emissor de verdade responde
 * "recebi, estou processando" e a prefeitura autoriza depois — quem desenha a
 * tela pressupondo resposta imediata trava no primeiro município lento.
 */
export const INVOICE_STATUSES = ['DRAFT', 'QUEUED', 'AUTHORIZED', 'REJECTED', 'CANCELED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Rascunho',
  QUEUED: 'Em processamento',
  AUTHORIZED: 'Autorizada',
  REJECTED: 'Rejeitada',
  CANCELED: 'Cancelada',
};

export const INVOICE_STATUS_TONES = {
  DRAFT: 'neutral',
  QUEUED: 'info',
  AUTHORIZED: 'success',
  REJECTED: 'danger',
  CANCELED: 'warning',
} as const satisfies Record<InvoiceStatus, 'neutral' | 'info' | 'warning' | 'accent' | 'success' | 'danger'>;

/**
 * Regime tributário da oficina. Muda a alíquota do ISS e o que sai escrito na
 * nota — Simples Nacional recolhe o ISS dentro da guia única, e a nota precisa
 * dizer isso.
 */
export const TAX_REGIMES = ['MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  MEI: 'MEI',
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

/**
 * Onde a nota foi parar. `SIMULATOR` é o driver de simulação: ele NÃO emite
 * nota nenhuma, serve para a oficina conferir o fluxo antes de contratar o
 * emissor — e tudo o que sai dele aparece marcado como simulação na tela.
 */
export const FISCAL_ENVIRONMENTS = ['SIMULATOR', 'HOMOLOGATION', 'PRODUCTION'] as const;
export type FiscalEnvironment = (typeof FISCAL_ENVIRONMENTS)[number];

export const FISCAL_ENVIRONMENT_LABELS: Record<FiscalEnvironment, string> = {
  SIMULATOR: 'Simulação (não vale como documento fiscal)',
  HOMOLOGATION: 'Homologação',
  PRODUCTION: 'Produção',
};
