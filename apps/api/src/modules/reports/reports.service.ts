import {
  type CabecalhoDoRelatorio,
  formatBRL,
  lucroEstimado,
  periodRange,
  REPORT_BY_KEY,
  REPORTS,
  reportFileName,
  reportToCsv,
  type Report,
  type ReportKey,
  type ReportPack,
  type ReportPackKey,
  type ReportQuery,
  REPORT_PACK_BY_KEY,
  REPORT_PACKS,
  reportPackToCsv,
} from '@oficinaos/shared';
import type { AuthContext, ServiceDeps } from '../../core/auth-context';
import { readTimezone } from '../../core/org-settings';
import { eq } from 'drizzle-orm';
import { organizations } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import * as financeRepo from '../finance/finance.repository';
import { gerarPdfDoRelatorio } from './reports.pdf';
import { REPORT_QUERIES, type Janela, type ReportResult } from './reports.queries';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const diaEMes = (key: string) => `${key.slice(8)}/${key.slice(5, 7)}`;

function rotuloDoPeriodo(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return diaEMes(fromDay);
  const mesmoMes = fromDay.slice(0, 7) === toDay.slice(0, 7);
  return mesmoMes
    ? `${Number(fromDay.slice(8))} a ${Number(toDay.slice(8))} de ${MESES[Number(fromDay.slice(5, 7)) - 1]}`
    : `${diaEMes(fromDay)} a ${diaEMes(toDay)}`;
}

/**
 * Relatórios (E15). Todos saem da mesma forma — colunas + linhas + totais +
 * uma frase de leitura — e todos exportam em CSV com um clique, porque o
 * contador pede planilha e a oficina não vai digitar de novo.
 *
 * O lucro estimado não tem consulta própria: ele é o do financeiro (E13), com
 * a mesma regra (a compra de peça não entra na despesa, já está no custo da
 * peça usada). Dois números diferentes para "lucro" seria o pior resultado
 * possível.
 */
export class ReportsService {
  constructor(private readonly deps: ServiceDeps) {}

  list(): { data: { key: ReportKey; title: string; question: string; snapshot: boolean }[] } {
    return {
      data: REPORTS.map((relatorio) => ({
        key: relatorio.key,
        title: relatorio.title,
        question: relatorio.question,
        snapshot: relatorio.snapshot ?? false,
      })),
    };
  }

  async get(auth: AuthContext, key: ReportKey, query: ReportQuery): Promise<Report> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const timeZone = await readTimezone(tx, auth.organizationId);
      const janela: Janela = periodRange(query.period, timeZone, { from: query.from, to: query.to });

      const resultado: ReportResult =
        key === 'profit'
          ? await this.lucro(tx, auth.organizationId, janela)
          : await REPORT_QUERIES[key](tx, auth.organizationId, janela, query.limit);

      const info = REPORT_BY_KEY[key];
      return {
        key,
        title: info.title,
        question: info.question,
        period: { from: janela.fromDay, to: janela.toDay, label: rotuloDoPeriodo(janela.fromDay, janela.toDay) },
        ...resultado,
      };
    });
  }

  /**
   * Quem é a oficina e quando o arquivo saiu — o que transforma uma grade de
   * números num documento que alguém consegue arquivar.
   */
  private async cabecalho(
    tx: Tx,
    organizationId: string,
    doc: { titulo: string; pergunta: string; periodo: string },
  ): Promise<CabecalhoDoRelatorio> {
    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    const tz = await readTimezone(tx, organizationId);
    return {
      organizacao: org?.name ?? 'Oficina',
      titulo: doc.titulo,
      pergunta: doc.pergunta,
      periodo: doc.periodo,
      emitidoEm: new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: tz,
      }).format(new Date()),
    };
  }

  /** O CSV pronto para o Excel em português, com o nome do arquivo. */
  async csv(auth: AuthContext, key: ReportKey, query: ReportQuery): Promise<{ fileName: string; content: string }> {
    const relatorio = await this.get(auth, key, query);
    const cabecalho = await withTenant(this.deps.db, auth, (tx) =>
      this.cabecalho(tx, auth.organizationId, doc(relatorio)),
    );
    return {
      fileName: reportFileName(relatorio.title, relatorio.period.from, relatorio.period.to),
      content: reportToCsv(relatorio.columns, relatorio.rows, { cabecalho, totals: relatorio.totals }),
    };
  }

  /** O PDF para ler e arquivar — o mesmo número do CSV, formatado para humano. */
  async pdf(auth: AuthContext, key: ReportKey, query: ReportQuery): Promise<{ fileName: string; content: Buffer }> {
    const relatorio = await this.get(auth, key, query);
    const cabecalho = await withTenant(this.deps.db, auth, (tx) =>
      this.cabecalho(tx, auth.organizationId, doc(relatorio)),
    );
    return {
      fileName: reportFileName(relatorio.title, relatorio.period.from, relatorio.period.to, 'pdf'),
      content: await gerarPdfDoRelatorio(cabecalho, [
        {
          titulo: relatorio.title,
          pergunta: relatorio.question,
          columns: relatorio.columns,
          rows: relatorio.rows,
          totals: relatorio.totals,
          summary: relatorio.summary,
        },
      ]),
    };
  }

  listPacks(): { data: { key: ReportPackKey; title: string; question: string; sections: string[] }[] } {
    return {
      data: REPORT_PACKS.map((pacote) => ({
        key: pacote.key,
        title: pacote.title,
        question: pacote.question,
        sections: pacote.sections.map((chave) => REPORT_BY_KEY[chave].title),
      })),
    };
  }

  /**
   * O pacote: cada seção é um relatório que já existe, consultado com o MESMO
   * período. Nenhuma consulta nova — se o número da seção divergisse do número
   * do relatório sozinho, a oficina teria dois "faturamento de setembro".
   */
  async pack(auth: AuthContext, key: ReportPackKey, query: ReportQuery): Promise<ReportPack> {
    const info = REPORT_PACK_BY_KEY[key];
    const secoes = [];
    let periodo: Report['period'] | null = null;
    for (const chave of info.sections) {
      const relatorio = await this.get(auth, chave, query);
      periodo ??= relatorio.period;
      secoes.push({
        key: chave,
        title: relatorio.title,
        question: relatorio.question,
        columns: relatorio.columns,
        rows: relatorio.rows,
        totals: relatorio.totals,
        summary: relatorio.summary,
      });
    }
    return {
      key,
      title: info.title,
      question: info.question,
      period: periodo ?? { from: query.from ?? '', to: query.to ?? '', label: '' },
      sections: secoes,
    };
  }

  async packCsv(
    auth: AuthContext,
    key: ReportPackKey,
    query: ReportQuery,
  ): Promise<{ fileName: string; content: string }> {
    const pacote = await this.pack(auth, key, query);
    const cabecalho = await this.cabecalhoDoPacote(auth, pacote);
    return {
      fileName: reportFileName(pacote.title, pacote.period.from, pacote.period.to),
      content: reportPackToCsv(cabecalho, pacote.sections.map(paraSecao)),
    };
  }

  async packPdf(
    auth: AuthContext,
    key: ReportPackKey,
    query: ReportQuery,
  ): Promise<{ fileName: string; content: Buffer }> {
    const pacote = await this.pack(auth, key, query);
    const cabecalho = await this.cabecalhoDoPacote(auth, pacote);
    return {
      fileName: reportFileName(pacote.title, pacote.period.from, pacote.period.to, 'pdf'),
      content: await gerarPdfDoRelatorio(cabecalho, pacote.sections.map(paraSecao)),
    };
  }

  private async cabecalhoDoPacote(auth: AuthContext, pacote: ReportPack): Promise<CabecalhoDoRelatorio> {
    return withTenant(this.deps.db, auth, (tx) =>
      this.cabecalho(tx, auth.organizationId, {
        titulo: pacote.title,
        pergunta: pacote.question,
        periodo: pacote.period.label,
      }),
    );
  }

  /** Lucro estimado: as mesmas contas da tela de fluxo de caixa (E13). */
  private async lucro(
    tx: Parameters<typeof financeRepo.receitaNoPeriodo>[0],
    organizationId: string,
    janela: Janela,
  ): Promise<ReportResult> {
    const receitaCents = await financeRepo.receitaNoPeriodo(tx, organizationId, janela);
    const custoPecasCents = await financeRepo.custoDasPecasNoPeriodo(tx, organizationId, janela);
    const categorias = await financeRepo.despesasPorCategoria(tx, organizationId, janela);
    const despesasCents = categorias
      .filter((linha) => linha.system_key !== 'PARTS')
      .reduce((soma, linha) => soma + Number(linha.total), 0);
    const resultado = lucroEstimado({ receitaCents, custoPecasCents, despesasCents });

    const rows = [
      { linha: 'Faturado (OS finalizadas)', valor: receitaCents },
      { linha: 'Custo das peças usadas', valor: -custoPecasCents },
      ...categorias
        .filter((categoria) => categoria.system_key !== 'PARTS')
        .map((categoria) => ({ linha: `Despesa paga: ${categoria.name}`, valor: -Number(categoria.total) })),
    ];
    const compraDePecas = categorias.find((categoria) => categoria.system_key === 'PARTS');

    return {
      columns: [
        { key: 'linha', label: 'Conta', format: 'text' },
        { key: 'valor', label: 'Valor', format: 'money' },
      ],
      rows,
      totals: { linha: 'Lucro estimado', valor: resultado.lucroCents },
      summary: `Margem de ${(resultado.margemBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%.${
        compraDePecas
          ? ` A compra de peças no período (${formatBRL(Number(compraDePecas.total))}) fica de fora: ela já está no custo da peça que saiu na OS.`
          : ''
      }`,
    };
  }
}

/** O que identifica o documento, tirado de um relatório. */
const doc = (relatorio: Report) => ({
  titulo: relatorio.title,
  pergunta: relatorio.question,
  periodo: relatorio.period.label,
});

/** Seção do pacote no formato que o CSV e o PDF consomem. */
const paraSecao = (secao: ReportPack['sections'][number]) => ({
  titulo: secao.title,
  pergunta: secao.question,
  columns: secao.columns,
  rows: secao.rows,
  totals: secao.totals,
  summary: secao.summary,
});
