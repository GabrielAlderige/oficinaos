import PDFDocument from 'pdfkit';
import {
  type CabecalhoDoRelatorio,
  formatReportCell,
  type ReportColumn,
  type ReportRow,
} from '@oficinaos/shared';

/**
 * O relatório em PDF (E44).
 *
 * O CSV serve para o contador somar; o PDF serve para a pessoa LER e arquivar
 * — mandar no WhatsApp, imprimir, anexar num processo. São públicos
 * diferentes, e por isso o PDF formata o número como a tela formata
 * ("R$ 1.234,56"), enquanto o CSV manda número cru para o Excel somar.
 *
 * Desenhado à mão com pdfkit em vez de renderizar HTML: um navegador sem
 * cabeça dentro do contêiner da API custaria centenas de megabytes e um
 * processo que trava, para desenhar uma tabela.
 */

/** Uma seção do documento: no relatório simples é uma só; no geral, várias. */
export interface SecaoDoPdf {
  titulo: string;
  pergunta?: string | null;
  columns: readonly ReportColumn[];
  rows: readonly ReportRow[];
  totals?: ReportRow | null;
  summary?: string | null;
}

const MARGEM = 40;
const LARGURA_PAGINA = 595.28; // A4 retrato
const UTIL = LARGURA_PAGINA - MARGEM * 2;

/** Colunas de número alinham à direita: é assim que a coluna se lê de cima a baixo. */
const NUMERICO = new Set(['money', 'number', 'quantity', 'percent', 'minutes']);

const CINZA = '#6b7280';
const TINTA = '#111827';
const LINHA = '#d1d5db';
const FAIXA = '#f3f4f6';

/**
 * Larguras proporcionais ao conteúdo: a primeira coluna (quase sempre o nome)
 * leva o dobro, porque "Troca de óleo do motor com filtro" quebrando em três
 * linhas enquanto a coluna de valor sobra espaço é o que deixa a tabela feia.
 */
function larguras(columns: readonly ReportColumn[]): number[] {
  const pesos = columns.map((coluna, i) => (i === 0 && !NUMERICO.has(coluna.format) ? 2.4 : 1));
  const soma = pesos.reduce((a, b) => a + b, 0);
  return pesos.map((peso) => (peso / soma) * UTIL);
}

export function gerarPdfDoRelatorio(cabecalho: CabecalhoDoRelatorio, secoes: readonly SecaoDoPdf[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
  const pedacos: Buffer[] = [];
  doc.on('data', (p: Buffer) => pedacos.push(p));
  const pronto = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(pedacos))));

  // ---- cabeçalho do documento ----
  doc.font('Helvetica-Bold').fontSize(16).fillColor(TINTA).text(cabecalho.organizacao);
  doc.font('Helvetica').fontSize(10).fillColor(CINZA).text(cabecalho.titulo);
  doc.moveDown(0.35);
  doc.fontSize(9).text(`Período: ${cabecalho.periodo}`);
  doc.text(`Emitido em: ${cabecalho.emitidoEm}`);
  doc.moveDown(0.6);
  doc.moveTo(MARGEM, doc.y).lineTo(LARGURA_PAGINA - MARGEM, doc.y).strokeColor(LINHA).lineWidth(1).stroke();
  doc.moveDown(0.8);

  for (const [indice, secao] of secoes.entries()) {
    if (indice > 0) doc.moveDown(1.2);
    desenharSecao(doc, secao);
  }

  // ---- rodapé em todas as páginas, com a numeração só no fim ----
  const total = doc.bufferedPageRange().count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(i);
    /**
     * O rodapé fica ABAIXO da margem inferior, e escrever ali faria o pdfkit
     * entender que a página acabou e abrir outra — era uma página em branco no
     * fim de todo relatório. Zerar a margem de baixo enquanto se escreve o
     * rodapé resolve; ela volta em seguida para não afetar o resto.
     */
    const margemDeBaixo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(CINZA)
      .text(
        `${cabecalho.organizacao} · ${cabecalho.titulo} · página ${i + 1} de ${total} · emitido pelo OficinaOS`,
        MARGEM,
        doc.page.height - MARGEM + 6,
        { width: UTIL, align: 'center', lineBreak: false },
      );
    doc.page.margins.bottom = margemDeBaixo;
  }

  doc.end();
  return pronto;
}

/**
 * Garante que ainda cabe `altura` na página; senão, abre a próxima.
 *
 * Sem isto, desenhar perto do rodapé faz o pdfkit paginar sozinho A CADA
 * `text()` — e o cabeçalho de uma tabela saía com um título de coluna por
 * página: "PEÇA" na 2, "QUANTIDADE" na 3, "CUSTO" na 4.
 */
function garantirEspaco(doc: PDFKit.PDFDocument, altura: number): void {
  if (doc.y + altura > doc.page.height - MARGEM - 14) doc.addPage();
}

/**
 * Volta o cursor para a margem esquerda, na largura inteira.
 *
 * Depois de desenhar as células da tabela com x e largura próprios, o pdfkit
 * guarda a posição da ÚLTIMA célula — e o próximo texto corrido herda aquela
 * faixa estreita na direita. Era o que espremia o título "Lucro estimado" num
 * filete e cortava a frase do resumo no meio.
 */
function daMargem(doc: PDFKit.PDFDocument): { width: number } {
  doc.x = MARGEM;
  return { width: UTIL };
}

function desenharSecao(doc: PDFKit.PDFDocument, secao: SecaoDoPdf): void {
  // o título de uma seção não fica sozinho no pé da página: ele e o começo da
  // tabela andam juntos, senão a pessoa vira a folha para saber do que se trata
  garantirEspaco(doc, 90);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TINTA).text(secao.titulo, daMargem(doc));
  if (secao.pergunta) {
    doc.font('Helvetica').fontSize(8.5).fillColor(CINZA).text(secao.pergunta, daMargem(doc));
  }
  doc.moveDown(0.4);

  if (secao.summary) {
    doc.font('Helvetica').fontSize(9.5).fillColor(TINTA).text(secao.summary, daMargem(doc));
    doc.moveDown(0.5);
  }

  if (!secao.rows.length) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(9)
      .fillColor(CINZA)
      .text('Nenhum lançamento no período.', daMargem(doc));
    doc.fillColor(TINTA);
    return;
  }

  const cols = secao.columns;
  const larg = larguras(cols);
  const alturaLinha = 16;

  const cabecalhoDaTabela = () => {
    // cabeçalho mais uma linha: cabeçalho sozinho no fim da página não serve
    garantirEspaco(doc, alturaLinha * 2);
    const y = doc.y;
    doc.rect(MARGEM, y - 2, UTIL, alturaLinha).fill(FAIXA);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(CINZA);
    let x = MARGEM;
    cols.forEach((coluna, i) => {
      doc.text(coluna.label.toUpperCase(), x + 4, y + 2, {
        width: larg[i]! - 8,
        align: NUMERICO.has(coluna.format) ? 'right' : 'left',
        lineBreak: false,
      });
      x += larg[i]!;
    });
    doc.y = y + alturaLinha;
  };

  cabecalhoDaTabela();

  doc.font('Helvetica').fontSize(8.5).fillColor(TINTA);
  for (const linha of secao.rows) {
    // quebra de página mantém o cabeçalho da tabela: tabela longa sem cabeçalho
    // na página 2 obriga a voltar para descobrir o que é cada coluna
    if (doc.y + alturaLinha > doc.page.height - MARGEM - 14) {
      doc.addPage();
      cabecalhoDaTabela();
      doc.font('Helvetica').fontSize(8.5).fillColor(TINTA);
    }

    const y = doc.y;
    let x = MARGEM;
    cols.forEach((coluna, i) => {
      doc.text(formatReportCell(linha[coluna.key] ?? null, coluna.format), x + 4, y + 2, {
        width: larg[i]! - 8,
        align: NUMERICO.has(coluna.format) ? 'right' : 'left',
        lineBreak: false,
        ellipsis: true,
      });
      x += larg[i]!;
    });
    doc.y = y + alturaLinha;
  }

  if (secao.totals) {
    garantirEspaco(doc, alturaLinha + 8);
    const y = doc.y;
    doc.moveTo(MARGEM, y).lineTo(LARGURA_PAGINA - MARGEM, y).strokeColor(LINHA).lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA);
    let x = MARGEM;
    cols.forEach((coluna, i) => {
      const valor = secao.totals?.[coluna.key];
      const texto = valor === undefined && i === 0 ? 'TOTAL' : formatReportCell(valor ?? null, coluna.format);
      doc.text(texto, x + 4, y + 5, {
        width: larg[i]! - 8,
        align: NUMERICO.has(coluna.format) ? 'right' : 'left',
        lineBreak: false,
      });
      x += larg[i]!;
    });
    doc.y = y + alturaLinha + 4;
  }
}
