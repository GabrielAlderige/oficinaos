/**
 * Formatação e exportação dos relatórios (E15). Pura: a API monta o CSV com as
 * mesmas funções que a tela usa para desenhar a tabela, então o que a pessoa vê
 * e o que ela baixa são o mesmo número.
 */

import type { ReportColumnFormat } from './enums/reports';
import { formatBRL } from './money';

export interface ReportColumn {
  key: string;
  label: string;
  format: ReportColumnFormat;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

const inteiro = new Intl.NumberFormat('pt-BR');
const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

/** "1h30" em vez de "90 min": é como a oficina fala de tempo de serviço. */
export function formatMinutesShort(minutos: number): string {
  if (minutos < 60) return `${Math.round(minutos)} min`;
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  return resto ? `${horas}h${String(resto).padStart(2, '0')}` : `${horas}h`;
}

/** A célula como aparece na tela. */
export function formatReportCell(valor: ReportCell, formato: ReportColumnFormat): string {
  if (valor === null || valor === '') return '–';
  switch (formato) {
    case 'money':
      return formatBRL(Number(valor));
    case 'number':
      return inteiro.format(Number(valor));
    case 'quantity':
      return decimal.format(Number(valor));
    case 'percent':
      return `${decimal.format(Number(valor) / 100)}%`;
    case 'minutes':
      return formatMinutesShort(Number(valor));
    case 'date':
      return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)
        ? `${valor.slice(8, 10)}/${valor.slice(5, 7)}/${valor.slice(0, 4)}`
        : String(valor);
    default:
      return String(valor);
  }
}

/**
 * A célula no CSV. Dinheiro sai como número com vírgula ("1234,56", sem "R$" e
 * sem ponto de milhar): é o que o Excel em português soma. Colocar "R$ 1.234,56"
 * faria a coluna inteira virar texto na planilha do contador.
 */
export function reportCellToCsv(valor: ReportCell, formato: ReportColumnFormat): string {
  if (valor === null) return '';
  switch (formato) {
    case 'money':
      return (Number(valor) / 100).toFixed(2).replace('.', ',');
    case 'percent':
      return (Number(valor) / 100).toFixed(2).replace('.', ',');
    case 'number':
    case 'minutes':
      return String(Math.round(Number(valor)));
    case 'quantity':
      return String(valor).replace('.', ',');
    default:
      return String(valor);
  }
}

const escapar = (valor: string): string => (/[";\n\r]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor);

/**
 * O CSV do relatório: separador `;` e BOM no começo — é assim que o Excel em
 * português abre o arquivo com as colunas separadas e os acentos certos, sem
 * ninguém precisar usar "importar dados".
 */
export function reportToCsv(columns: readonly ReportColumn[], rows: readonly ReportRow[]): string {
  const cabecalho = columns.map((coluna) => escapar(coluna.label)).join(';');
  const linhas = rows.map((linha) =>
    columns.map((coluna) => escapar(reportCellToCsv(linha[coluna.key] ?? null, coluna.format))).join(';'),
  );
  return `${String.fromCharCode(0xfeff)}${[cabecalho, ...linhas].join('\r\n')}\r\n`;
}

/** "faturamento-2026-09-01-a-2026-09-30.csv" */
export const reportFileName = (titulo: string, from: string, to: string): string =>
  `${titulo
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}-${from}-a-${to}.csv`;
