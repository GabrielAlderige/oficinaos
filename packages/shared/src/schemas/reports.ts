import { z } from 'zod';
import { DASHBOARD_PERIODS } from '../calendar';
import { REPORT_COLUMN_FORMATS, REPORT_KEYS } from '../enums/reports';

/**
 * Relatórios (E15). A resposta traz as COLUNAS junto com as linhas: a tela
 * desenha qualquer relatório com o mesmo componente, e um relatório novo não
 * precisa de tela nova.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

export const reportQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default('month'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** quantas linhas no máximo (os rankings cortam nas primeiras) */
  limit: z.coerce.number().int().min(1).max(500).default(100),
  /** `csv` devolve o arquivo pronto para o Excel */
  format: z.enum(['json', 'csv']).default('json'),
});

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  format: z.enum(REPORT_COLUMN_FORMATS),
});

export const reportSchema = z.object({
  key: z.enum(REPORT_KEYS),
  title: z.string(),
  question: z.string(),
  period: z.object({ from: z.string(), to: z.string(), label: z.string() }),
  columns: z.array(reportColumnSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  /** a linha de rodapé, quando somar faz sentido */
  totals: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).nullable(),
  /** uma frase com a leitura do número, para quem não lê tabela */
  summary: z.string().nullable(),
});

export const reportListSchema = z.object({
  data: z.array(z.object({ key: z.enum(REPORT_KEYS), title: z.string(), question: z.string(), snapshot: z.boolean() })),
});

export type ReportQuery = z.output<typeof reportQuerySchema>;
export type Report = z.infer<typeof reportSchema>;
export type ReportColumnDto = z.infer<typeof reportColumnSchema>;
