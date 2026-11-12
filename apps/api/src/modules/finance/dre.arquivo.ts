import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { DreComparada, DreLinhaComparada } from '@oficinaos/shared';

/**
 * A DRE em arquivo (E51, fase 2): Excel com fórmulas e PDF para ler.
 *
 * O Excel segue a planilha do escritório (aba MOREDO): a sintética é
 * `=SUM` das analíticas logo abaixo dela, cada "(=)" é a soma das linhas que
 * a compõem, e o "%" de cada mês divide pela receita bruta daquele mês. Quem
 * mexer num valor de item vê o grupo e o lucro mudarem, como na planilha deles.
 *
 * O PDF segue o "DRE APRESENTAÇÃO": empresa e CNPJ em cima, os meses nas
 * colunas, Total, % e Média no fim, e a data de emissão no rodapé.
 */

export interface CabecalhoDaDre {
  empresa: string;
  /** CNPJ (ou CPF) já formatado; null quando a oficina não cadastrou */
  documento: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  regime: string;
  emitidoEm: string;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** '2026-09' → 'set/2026' */
export const rotuloDoMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`;

export const periodoDaDre = (meses: string[]) =>
  meses.length === 1 ? rotuloDoMes(meses[0]!) : `${rotuloDoMes(meses[0]!)} a ${rotuloDoMes(meses.at(-1)!)}`;

/** As linhas que entram no "Resumo dos impostos": os impostos da receita e a provisão do IR. */
const impostosDoResumo = (linhas: DreLinhaComparada[]) =>
  linhas.filter((l) => l.kind === 'item' && (l.parent === 'deducoes' || l.parent === 'provisao_ir'));

const reais = (centavos: number) => centavos / 100;

// =============================== Excel ===============================

const FORMATO_VALOR = '#,##0.00;[Red]\\(#,##0.00\\)';
const FORMATO_PCT = '0.0%;[Red]\\(0.0%\\)';
const FONTE = { name: 'Calibri', size: 11 };
const CINZA_GRUPO = 'FFF2F2F2';
const CINZA_RESULTADO = 'FFE7E6E6';

/** A coluna (letra) do n-ésimo número, contando a partir de 1 = A. */
const letra = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export async function gerarXlsxDaDre(cab: CabecalhoDaDre, dre: DreComparada): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OficinaOS';
  wb.created = new Date();
  // o Excel recalcula ao abrir: o valor guardado em cada fórmula é só para quem pré-visualiza
  wb.calcProperties.fullCalcOnLoad = true;
  const ws = wb.addWorksheet('DRE', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 15 },
  });

  const n = dre.meses.length;
  const varios = n > 1;
  // A = nome da conta; depois, por mês, valor e %; no fim (com mais de um mês) Total, % e Média
  const colValor = (i: number) => 2 + i * 2;
  const colPct = (i: number) => 3 + i * 2;
  const colTotal = 2 + n * 2;
  const ultimaColuna = varios ? colTotal + 2 : colPct(n - 1);

  // ---- cabeçalho ----
  const titulo = ws.getCell('A1');
  titulo.value = 'DRE - Demonstração do Resultado do Exercício';
  titulo.font = { ...FONTE, size: 14, bold: true };
  const campo = (linha: number, rotulo: string, valor: string) => {
    ws.getCell(linha, 1).value = { richText: [{ text: `${rotulo} `, font: { ...FONTE, bold: true } }, { text: valor, font: FONTE }] };
  };
  campo(2, 'Empresa:', cab.empresa);
  campo(
    3,
    'CNPJ:',
    [
      cab.documento ?? 'não cadastrado',
      cab.inscricaoEstadual ? `   Inscrição Estadual: ${cab.inscricaoEstadual}` : '',
      cab.inscricaoMunicipal ? `   Inscrição Municipal: ${cab.inscricaoMunicipal}` : '',
    ].join(''),
  );
  campo(4, 'Regime tributário:', cab.regime);
  campo(5, 'Período:', `${periodoDaDre(dre.meses)} (regime de competência)`);
  campo(6, 'Emitido em:', `${cab.emitidoEm} pelo OficinaOS`);

  // ---- títulos das colunas ----
  const TOPO = 8;
  const cabecalho = ws.getRow(TOPO);
  cabecalho.getCell(1).value = 'NOME DA CONTA';
  dre.meses.forEach((mes, i) => {
    cabecalho.getCell(colValor(i)).value = rotuloDoMes(mes);
    cabecalho.getCell(colPct(i)).value = '%';
  });
  if (varios) {
    cabecalho.getCell(colTotal).value = 'TOTAL';
    cabecalho.getCell(colTotal + 1).value = '%';
    cabecalho.getCell(colTotal + 2).value = 'MÉDIA';
  }
  for (let c = 1; c <= ultimaColuna; c += 1) {
    const cel = cabecalho.getCell(c);
    cel.font = { ...FONTE, bold: true };
    cel.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
    cel.border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
  }

  // ---- linhas da DRE ----
  const linhaDe = new Map<string, number>();
  dre.linhas.forEach((l, i) => linhaDe.set(l.key, TOPO + 1 + i));
  const rBruta = linhaDe.get('receita_bruta')!;

  /** a fórmula da célula da linha `l`, na coluna `col` */
  const formula = (l: DreLinhaComparada, col: string): string | null => {
    if (l.kind === 'grupo') {
      const itens = dre.linhas.filter((x) => x.parent === l.key).map((x) => linhaDe.get(x.key)!);
      return itens.length ? `SUM(${col}${Math.min(...itens)}:${col}${Math.max(...itens)})` : null;
    }
    if (l.kind === 'resultado') return (l.compoe ?? []).map((k) => `${col}${linhaDe.get(k)}`).join('+') || null;
    return null;
  };

  for (const l of dre.linhas) {
    const r = linhaDe.get(l.key)!;
    const row = ws.getRow(r);
    const nome = row.getCell(1);
    nome.value = l.label;
    nome.alignment = { indent: l.kind === 'item' ? 2 : 0 };

    dre.meses.forEach((_, i) => {
      const col = letra(colValor(i));
      const valor = row.getCell(colValor(i));
      const f = formula(l, col);
      valor.value = f ? { formula: f, result: reais(l.valores[i]!) } : reais(l.valores[i]!);
      valor.numFmt = FORMATO_VALOR;
      const pct = row.getCell(colPct(i));
      const bruta = dre.linhas[rBruta - TOPO - 1]!.valores[i]!;
      pct.value = { formula: `IFERROR(${col}${r}/${col}$${rBruta},0)`, result: bruta ? l.valores[i]! / bruta : 0 };
      pct.numFmt = FORMATO_PCT;
    });
    if (varios) {
      const T = letra(colTotal);
      const total = row.getCell(colTotal);
      total.value = { formula: dre.meses.map((_, i) => `${letra(colValor(i))}${r}`).join('+'), result: reais(l.amountCents) };
      total.numFmt = FORMATO_VALOR;
      const brutaTotal = dre.linhas[rBruta - TOPO - 1]!.amountCents;
      const pct = row.getCell(colTotal + 1);
      pct.value = { formula: `IFERROR(${T}${r}/${T}$${rBruta},0)`, result: brutaTotal ? l.amountCents / brutaTotal : 0 };
      pct.numFmt = FORMATO_PCT;
      const media = row.getCell(colTotal + 2);
      media.value = { formula: `${T}${r}/${n}`, result: reais(l.amountCents) / n };
      media.numFmt = FORMATO_VALOR;
    }

    const destaque = l.kind !== 'item';
    for (let c = 1; c <= ultimaColuna; c += 1) {
      const cel = row.getCell(c);
      cel.font = { ...FONTE, bold: destaque };
      if (destaque) {
        cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: l.kind === 'resultado' ? CINZA_RESULTADO : CINZA_GRUPO } };
      }
      if (l.kind === 'resultado') cel.border = { top: { style: 'thin' } };
    }
  }

  // ---- resumo dos impostos (como o "RESUMO IMPOSTOS/PROVISÕES" da planilha deles) ----
  const impostos = impostosDoResumo(dre.linhas);
  if (impostos.length) {
    const inicio = TOPO + dre.linhas.length + 2;
    const titulos = ws.getRow(inicio);
    titulos.getCell(1).value = 'RESUMO DOS IMPOSTOS E PROVISÕES';
    dre.meses.forEach((mes, i) => {
      titulos.getCell(colValor(i)).value = rotuloDoMes(mes);
      titulos.getCell(colPct(i)).value = '%';
    });
    if (varios) {
      titulos.getCell(colTotal).value = 'TOTAL';
      titulos.getCell(colTotal + 1).value = '%';
      titulos.getCell(colTotal + 2).value = 'MÉDIA';
    }
    for (let c = 1; c <= ultimaColuna; c += 1) {
      const cel = titulos.getCell(c);
      cel.font = { ...FONTE, bold: true };
      cel.alignment = { horizontal: c === 1 ? 'left' : 'center' };
      cel.border = { top: { style: 'medium' }, bottom: { style: 'medium' } };
    }
    const fim = inicio + impostos.length + 1;
    impostos.forEach((l, k) => {
      const r = inicio + 1 + k;
      const row = ws.getRow(r);
      row.getCell(1).value = l.label;
      const colunas = varios ? [...dre.meses.map((_, i) => colValor(i)), colTotal, colTotal + 2] : [colValor(0)];
      for (const c of colunas) {
        const cel = row.getCell(c);
        const origem = ws.getCell(linhaDe.get(l.key)!, c);
        cel.value = { formula: `${letra(c)}${linhaDe.get(l.key)}`, result: valorDe(origem.value) };
        cel.numFmt = FORMATO_VALOR;
      }
      for (const c of varios ? [...dre.meses.map((_, i) => colPct(i)), colTotal + 1] : [colPct(0)]) {
        const v = letra(c - 1);
        const cel = row.getCell(c);
        cel.value = { formula: `IFERROR(${v}${r}/${v}$${rBruta},0)`, result: valorDe(ws.getCell(linhaDe.get(l.key)!, c).value) };
        cel.numFmt = FORMATO_PCT;
      }
    });
    const totalRow = ws.getRow(fim);
    totalRow.getCell(1).value = 'TOTAL DOS IMPOSTOS';
    for (let c = 2; c <= ultimaColuna; c += 1) {
      const ehPct = varios ? c === colTotal + 1 || (c < colTotal && (c - 2) % 2 === 1) : c === colPct(0);
      const cel = totalRow.getCell(c);
      if (ehPct) {
        const v = letra(c - 1);
        cel.value = { formula: `IFERROR(${v}${fim}/${v}$${rBruta},0)` };
        cel.numFmt = FORMATO_PCT;
      } else {
        cel.value = { formula: `SUM(${letra(c)}${inicio + 1}:${letra(c)}${fim - 1})` };
        cel.numFmt = FORMATO_VALOR;
      }
    }
    for (let c = 1; c <= ultimaColuna; c += 1) {
      const cel = totalRow.getCell(c);
      cel.font = { ...FONTE, bold: true };
      cel.border = { top: { style: 'thin' } };
    }
  }

  ws.getColumn(1).width = 46;
  for (let c = 2; c <= ultimaColuna; c += 1) {
    const ehPct = varios ? c === colTotal + 1 || (c < colTotal && (c - 2) % 2 === 1) : c === colPct(0);
    ws.getColumn(c).width = ehPct ? 8 : 14;
  }
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: TOPO }];
  ws.pageSetup.printTitlesRow = `${TOPO}:${TOPO}`;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** O número de uma célula, seja valor puro ou fórmula com resultado guardado. */
function valorDe(v: ExcelJS.CellValue): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v && typeof v.result === 'number') return v.result;
  return 0;
}

// =============================== PDF ===============================

const A4_PAISAGEM: [number, number] = [841.89, 595.28];
const A4_RETRATO: [number, number] = [595.28, 841.89];
const MARGEM = 28;
const TINTA = '#111827';
const CINZA = '#4b5563';
const FUNDO_GRUPO = '#f3f4f6';
const FUNDO_RESULTADO = '#e5e7eb';

/** 1234.5 → "1.234,50"; negativo entre parênteses, como no modelo do escritório */
export const numeroContabil = (centavos: number): string => {
  const texto = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Math.abs(centavos) / 100,
  );
  return centavos < 0 ? `(${texto})` : texto;
};
const porcento = (parte: number, todo: number) =>
  todo ? `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format((parte / todo) * 100)}%` : '0,0%';

export function gerarPdfDaDre(cab: CabecalhoDaDre, dre: DreComparada): Promise<Buffer> {
  // vários meses precisam da folha deitada; um mês só cabe em pé, numa página
  const folha = dre.meses.length > 1 ? A4_PAISAGEM : A4_RETRATO;
  const doc = new PDFDocument({ size: folha, margin: MARGEM, bufferPages: true });
  const pedacos: Buffer[] = [];
  doc.on('data', (p: Buffer) => pedacos.push(p));
  const pronto = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(pedacos))));

  const largura = folha[0] - MARGEM * 2;
  const n = dre.meses.length;
  const varios = n > 1;
  const bruta = dre.linhas.find((l) => l.key === 'receita_bruta')!;

  // as colunas de número: um mês sozinho mostra valor e %; vários, os meses e depois Total, % e Média
  interface Coluna {
    titulo: string;
    texto: (l: DreLinhaComparada) => string;
  }
  const colunas: Coluna[] = varios
    ? [
        ...dre.meses.map((mes, i) => ({ titulo: rotuloDoMes(mes), texto: (l: DreLinhaComparada) => numeroContabil(l.valores[i]!) })),
        { titulo: 'Total', texto: (l) => numeroContabil(l.amountCents) },
        { titulo: '%', texto: (l) => porcento(l.amountCents, bruta.amountCents) },
        { titulo: 'Média', texto: (l) => numeroContabil(Math.round(l.amountCents / n)) },
      ]
    : [
        { titulo: rotuloDoMes(dre.meses[0]!), texto: (l) => numeroContabil(l.valores[0]!) },
        { titulo: '% da receita', texto: (l) => porcento(l.valores[0]!, bruta.valores[0]!) },
      ];

  // a letra diminui até a coluna mais larga caber; o nome da conta fica com o que sobrar
  const PAD = 6;
  let corpo = 8;
  let larguras: number[] = [];
  let nome = 0;
  for (; corpo >= 5.5; corpo -= 0.5) {
    doc.font('Helvetica-Bold').fontSize(corpo);
    larguras = colunas.map((c) => Math.max(doc.widthOfString(c.titulo), ...dre.linhas.map((l) => doc.widthOfString(c.texto(l)))) + PAD);
    nome = largura - larguras.reduce((a, b) => a + b, 0);
    if (nome >= (varios ? 150 : 260)) break;
  }
  if (!varios) {
    // um mês só: a folha em pé, com o valor e o % largos e o nome da conta com o resto
    larguras = larguras.map((w) => Math.max(w, 95));
    nome = largura - larguras.reduce((a, b) => a + b, 0);
  }
  const alturaLinha = corpo + 6;

  const tracejado = (y: number) => {
    doc.save().moveTo(MARGEM, y).lineTo(MARGEM + largura, y).dash(2, { space: 2 }).strokeColor(CINZA).lineWidth(0.6).stroke().restore();
  };

  const cabecalhoDaPagina = () => {
    let y = MARGEM;
    doc.font('Helvetica').fontSize(9).fillColor(CINZA).text('Empresa:', MARGEM, y, { continued: true });
    doc.font('Helvetica-Bold').fillColor(TINTA).text(`  ${cab.empresa}`);
    y += 13;
    const pares: [string, string][] = [
      ['CNPJ:', cab.documento ?? 'não cadastrado'],
      ...(cab.inscricaoEstadual ? ([['Inscrição Estadual:', cab.inscricaoEstadual]] as [string, string][]) : []),
      ...(cab.inscricaoMunicipal ? ([['Inscrição Municipal:', cab.inscricaoMunicipal]] as [string, string][]) : []),
      ['Regime:', cab.regime],
    ];
    let x = MARGEM;
    for (const [rotulo, valor] of pares) {
      // na folha em pé não cabe tudo numa linha: o que não cabe desce
      doc.font('Helvetica-Bold').fontSize(9);
      const precisa = doc.widthOfString(`${rotulo} ${valor}`) + 8;
      if (x > MARGEM && x + precisa > MARGEM + largura) {
        x = MARGEM;
        y += 13;
      }
      doc.font('Helvetica').fontSize(9).fillColor(CINZA).text(rotulo, x, y, { lineBreak: false });
      x += doc.widthOfString(rotulo) + 4;
      doc.font('Helvetica-Bold').fillColor(TINTA).text(valor, x, y, { lineBreak: false });
      x += doc.widthOfString(valor) + 28;
    }
    y += 16;
    tracejado(y);
    y += 7;
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TINTA).text('DRE - DEMONSTRAÇÃO DO RESULTADO', MARGEM, y, { width: largura, align: 'center' });
    y += 17;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(CINZA)
      .text(`Período: ${periodoDaDre(dre.meses)}  ·  regime de competência`, MARGEM, y, { width: largura, align: 'center' });
    y += 13;
    tracejado(y);
    y += 8;
    // títulos das colunas
    doc.font('Helvetica-Bold').fontSize(corpo).fillColor(TINTA);
    let cx = MARGEM + nome;
    colunas.forEach((c, i) => {
      doc.text(c.titulo, cx, y, { width: larguras[i]! - 2, align: 'right', lineBreak: false });
      cx += larguras[i]!;
    });
    y += alturaLinha - 1;
    doc.save().moveTo(MARGEM, y).lineTo(MARGEM + nome + larguras.reduce((a, b) => a + b, 0), y).strokeColor(TINTA).lineWidth(0.8).stroke().restore();
    return y + 3;
  };

  const RODAPE = 26;
  const limite = folha[1] - MARGEM - RODAPE;
  const larguraTabela = nome + larguras.reduce((a, b) => a + b, 0);

  /** o nome que não cabe na coluna é cortado com "…" (quebrar a linha jogaria o texto em cima da próxima) */
  const cortado = (texto: string, max: number) => {
    if (doc.widthOfString(texto) <= max) return texto;
    let t = texto;
    while (t.length > 1 && doc.widthOfString(`${t}…`) > max) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };

  const desenharLinha = (l: DreLinhaComparada, y: number) => {
    if (l.kind !== 'item') {
      doc.save().rect(MARGEM, y - 1.5, larguraTabela, alturaLinha).fill(l.kind === 'resultado' ? FUNDO_RESULTADO : FUNDO_GRUPO).restore();
    }
    const fonte = l.kind === 'item' ? 'Helvetica' : 'Helvetica-Bold';
    const recuo = l.kind === 'item' ? 12 : 2;
    doc.font(fonte).fontSize(corpo).fillColor(TINTA);
    doc.text(cortado(l.label, nome - recuo - 6), MARGEM + recuo, y, { lineBreak: false });
    let cx = MARGEM + nome;
    colunas.forEach((c, i) => {
      doc.text(c.texto(l), cx, y, { width: larguras[i]! - 2, align: 'right', lineBreak: false });
      cx += larguras[i]!;
    });
  };

  let y = cabecalhoDaPagina();
  for (const l of dre.linhas) {
    if (y + alturaLinha > limite) {
      doc.addPage();
      y = cabecalhoDaPagina();
    }
    desenharLinha(l, y);
    y += alturaLinha;
  }

  // ---- resumo dos impostos ----
  const impostos = impostosDoResumo(dre.linhas);
  if (impostos.length) {
    const total: DreLinhaComparada = {
      key: 'total_impostos',
      label: 'Total dos impostos',
      kind: 'resultado',
      parent: null,
      shareBps: 0,
      amountCents: impostos.reduce((t, l) => t + l.amountCents, 0),
      valores: dre.meses.map((_, i) => impostos.reduce((t, l) => t + l.valores[i]!, 0)),
    };
    if (y + alturaLinha * (impostos.length + 3) > limite) {
      doc.addPage();
      y = cabecalhoDaPagina();
    } else {
      y += alturaLinha;
    }
    doc.font('Helvetica-Bold').fontSize(corpo + 0.5).fillColor(TINTA).text('Resumo dos impostos e provisões', MARGEM + 2, y);
    y += alturaLinha + 2;
    for (const l of [...impostos.map((i) => ({ ...i })), total]) {
      desenharLinha(l, y);
      y += alturaLinha;
    }
  }

  if (dre.avisos.length) {
    y += 6;
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(CINZA);
    for (const aviso of dre.avisos) {
      if (y + 10 > limite) break;
      doc.text(`* ${aviso}`, MARGEM, y, { width: largura });
      y = doc.y + 1;
    }
  }

  // ---- rodapé em todas as páginas ----
  const total = doc.bufferedPageRange().count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(i);
    // sem margem de baixo enquanto escreve o rodapé: senão o pdfkit acha que estourou e abre página nova
    doc.page.margins.bottom = 0;
    const yr = folha[1] - MARGEM - 10;
    doc.font('Helvetica').fontSize(8).fillColor(CINZA);
    doc.text(`Data e hora da impressão: ${cab.emitidoEm}  ·  OficinaOS`, MARGEM, yr, { lineBreak: false });
    doc.text(`Página ${i + 1} de ${total}`, MARGEM, yr, { width: largura, align: 'right', lineBreak: false });
  }
  doc.end();
  return pronto;
}
