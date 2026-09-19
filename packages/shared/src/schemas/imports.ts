import { z } from 'zod';

/**
 * Importação de planilha (MVP 2, E17). A oficina que troca de sistema chega
 * com um CSV de clientes, veículos e peças — e digitar tudo de novo é o que
 * faz ela desistir na primeira semana.
 *
 * Duas regras: **conferir antes de gravar** (`dryRun`, que é o padrão da tela)
 * e **linha ruim não derruba o arquivo** — ela volta com o número da linha e o
 * motivo, como na lista de preço da E14.
 */

export const IMPORT_KINDS = ['customers', 'vehicles', 'parts'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  customers: 'Clientes',
  vehicles: 'Veículos',
  parts: 'Peças',
};

/** As colunas que cada importação entende, para a tela mostrar o modelo. */
export const IMPORT_COLUMNS: Record<ImportKind, { obrigatorias: string[]; opcionais: string[] }> = {
  customers: {
    obrigatorias: ['nome'],
    opcionais: ['whatsapp', 'telefone', 'email', 'documento', 'observacoes'],
  },
  vehicles: {
    obrigatorias: ['placa', 'marca', 'modelo'],
    // o cliente é achado pelo documento, pelo telefone ou pelo nome exato
    opcionais: ['cliente', 'documento', 'telefone', 'ano', 'anomodelo', 'cor', 'km', 'chassi'],
  },
  parts: {
    obrigatorias: ['nome'],
    opcionais: ['sku', 'codigo', 'marca', 'categoria', 'preco', 'custo', 'quantidade', 'minimo', 'unidade'],
  },
};

export const importRequestSchema = z.object({
  csv: z.string().min(1, 'Arquivo vazio').max(4_000_000, 'Arquivo grande demais (máx. 4 MB)'),
  /** padrão: só confere. A tela só grava depois que a pessoa vê o resultado */
  dryRun: z.boolean().default(true),
});

export const importProblemSchema = z.object({
  line: z.number().int(),
  reason: z.string(),
  /** o que estava na linha, para a pessoa achar na planilha dela */
  value: z.string().nullable(),
});

export const importResultSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  dryRun: z.boolean(),
  total: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  problems: z.array(importProblemSchema),
  /** as primeiras linhas já interpretadas: é o que a tela mostra na conferência */
  preview: z.array(z.record(z.string(), z.string())),
});

export type ImportRequest = z.output<typeof importRequestSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type ImportProblem = z.infer<typeof importProblemSchema>;
