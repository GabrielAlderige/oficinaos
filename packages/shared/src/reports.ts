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

/** O que identifica o documento, igual no CSV e no PDF. */
export interface CabecalhoDoRelatorio {
  /** nome fantasia da oficina */
  organizacao: string;
  titulo: string;
  pergunta: string;
  periodo: string;
  /** quando o arquivo foi gerado, já formatado */
  emitidoEm: string;
}

/**
 * O CSV do relatório: separador `;` e BOM no começo — é assim que o Excel em
 * português abre o arquivo com as colunas separadas e os acentos certos, sem
 * ninguém precisar usar "importar dados".
 *
 * Antes da tabela vai um cabeçalho com a oficina, o período e a hora da
 * emissão. Sem isso, a planilha que chega no contador é uma grade de números
 * sem dizer de quem é nem de quando — e, três meses depois, ninguém sabe se
 * aquele arquivo era de agosto ou de setembro. O total fecha embaixo, porque é
 * a primeira coisa que se procura.
 */
export function reportToCsv(
  columns: readonly ReportColumn[],
  rows: readonly ReportRow[],
  opcoes?: { cabecalho?: CabecalhoDoRelatorio; totals?: ReportRow | null },
): string {
  const linhas: string[] = [];
  const cab = opcoes?.cabecalho;
  if (cab) {
    linhas.push(escapar(cab.organizacao));
    linhas.push(escapar(cab.titulo));
    if (cab.pergunta) linhas.push(escapar(cab.pergunta));
    linhas.push(`${escapar('Período')};${escapar(cab.periodo)}`);
    linhas.push(`${escapar('Emitido em')};${escapar(cab.emitidoEm)}`);
    // linha vazia separa o cabeçalho da tabela: o Excel entende a grade abaixo
    linhas.push('');
  }

  linhas.push(columns.map((coluna) => escapar(coluna.label)).join(';'));
  for (const linha of rows) {
    linhas.push(columns.map((c) => escapar(reportCellToCsv(linha[c.key] ?? null, c.format))).join(';'));
  }

  const totais = opcoes?.totals;
  if (totais) {
    linhas.push('');
    linhas.push(
      columns
        .map((c, i) =>
          // a primeira coluna vira o rótulo quando o total não tem valor próprio
          totais[c.key] === undefined && i === 0
            ? escapar('TOTAL')
            : escapar(reportCellToCsv(totais[c.key] ?? null, c.format)),
        )
        .join(';'),
    );
  }

  const quebra = '\r\n';
  return `${String.fromCharCode(0xfeff)}${linhas.join(quebra)}${quebra}`;
}

/** Uma seção do pacote: o mesmo formato de um relatório sozinho. */
export interface SecaoDoRelatorio {
  titulo: string;
  pergunta?: string | null;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  totals?: ReportRow | null;
  summary?: string | null;
}

/**
 * Várias seções num CSV só (E44).
 *
 * O Excel não tem "aba" dentro de CSV, então as seções vão uma embaixo da
 * outra, separadas por uma linha em branco e por um título — é o formato que
 * todo escritório de contabilidade já recebe e sabe recortar. Um .zip com nove
 * arquivos seria mais puro e pior: ninguém abre nove arquivos.
 */
export function reportPackToCsv(cabecalho: CabecalhoDoRelatorio, secoes: readonly SecaoDoRelatorio[]): string {
  const partes: string[] = [];
  for (const [i, secao] of secoes.entries()) {
    const corpo = reportToCsv(secao.columns, secao.rows, {
      cabecalho:
        i === 0
          ? { ...cabecalho, titulo: `${cabecalho.titulo} — ${secao.titulo}`, pergunta: secao.pergunta ?? '' }
          : undefined,
      totals: secao.totals ?? null,
    });
    // só a primeira seção leva o BOM: o resto é continuação do mesmo arquivo
    const semBom = i === 0 ? corpo : corpo.slice(1);
    partes.push(i === 0 ? semBom : `${escapar(secao.titulo)}\r\n${semBom}`);
  }
  return partes.join('\r\n');
}

/** "faturamento-2026-09-01-a-2026-09-30.csv" */
export const reportFileName = (titulo: string, from: string, to: string, extensao = 'csv'): string =>
  `${titulo
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')}-${from}-a-${to}.${extensao}`;
