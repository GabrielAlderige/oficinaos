/**
 * Leitor de CSV (E14). Existe porque a oficina vive de planilha: a lista de
 * preço do fornecedor chega em CSV, e a importação de clientes, veículos e
 * peças (plataforma) vai usar o mesmo leitor.
 *
 * O que ele aguenta, porque é o que aparece no Brasil:
 * - separador `;` (o Excel em português salva assim) ou `,`, detectado sozinho;
 * - aspas com separador, quebra de linha e aspas duplicadas dentro;
 * - BOM do Excel no começo do arquivo;
 * - fim de linha `\r\n` ou `\n`.
 */

export type CsvRow = Record<string, string>;

/**
 * Os dois caracteres invisíveis que este arquivo precisa citar: o BOM que o
 * Excel põe no começo do arquivo e as marcas de acento da decomposição NFD.
 * Escritos por código de propósito — digitados, viram bytes invisíveis no meio
 * do fonte (e o lint reclama, com razão).
 */
const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/** Separador mais frequente fora das aspas na primeira linha. */
function detectarSeparador(texto: string): string {
  const primeira = texto.slice(0, texto.indexOf('\n') === -1 ? texto.length : texto.indexOf('\n'));
  let dentro = false;
  const contagem: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };
  for (const char of primeira) {
    if (char === '"') dentro = !dentro;
    else if (!dentro && char in contagem) contagem[char] = (contagem[char] ?? 0) + 1;
  }
  return Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]![1] > 0
    ? Object.entries(contagem).sort((a, b) => b[1] - a[1])[0]![0]
    : ';';
}

/** As linhas cruas, já respeitando aspas. A primeira é o cabeçalho. */
export function parseCsvLines(texto: string, separador?: string): string[][] {
  const limpo = texto.replace(BOM, '');
  const sep = separador ?? detectarSeparador(limpo);
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let dentroDeAspas = false;

  for (let i = 0; i < limpo.length; i += 1) {
    const char = limpo[i]!;
    if (dentroDeAspas) {
      if (char === '"') {
        if (limpo[i + 1] === '"') {
          campo += '"';
          i += 1;
        } else {
          dentroDeAspas = false;
        }
      } else {
        campo += char;
      }
      continue;
    }
    if (char === '"') {
      dentroDeAspas = true;
    } else if (char === sep) {
      linha.push(campo);
      campo = '';
    } else if (char === '\n') {
      linha.push(campo.replace(/\r$/, ''));
      linhas.push(linha);
      linha = [];
      campo = '';
    } else {
      campo += char;
    }
  }
  if (campo !== '' || linha.length) {
    linha.push(campo.replace(/\r$/, ''));
    linhas.push(linha);
  }
  // linha em branco no fim do arquivo não é registro
  return linhas.filter((l) => l.some((valor) => valor.trim() !== ''));
}

/** Cabeçalho sem acento, sem espaço e em minúsculas: "Preço Unit." → "precounit". */
export const normalizeHeader = (valor: string): string =>
  valor
    .normalize('NFD')
    .replace(MARCAS_DE_ACENTO, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * CSV → objetos, com as chaves normalizadas. Colunas a mais são ignoradas, e
 * coluna que falta vira string vazia: planilha de fornecedor nunca vem do jeito
 * que a gente pediu.
 */
export function parseCsv(texto: string, separador?: string): { headers: string[]; rows: CsvRow[] } {
  const linhas = parseCsvLines(texto, separador);
  if (!linhas.length) return { headers: [], rows: [] };
  const headers = linhas[0]!.map(normalizeHeader);
  const rows = linhas.slice(1).map((linha) => {
    const row: CsvRow = {};
    headers.forEach((header, indice) => {
      if (header) row[header] = (linha[indice] ?? '').trim();
    });
    return row;
  });
  return { headers, rows };
}

/**
 * O valor como o fornecedor escreve: "1.234,56", "1234.56", "R$ 89,90", "89".
 * Diferente do `parseBRL`, aqui o ponto PODE ser decimal — planilha exportada
 * de sistema estrangeiro vem assim — então a regra é: se só houver um
 * separador e ele tiver 1 ou 2 casas depois, é decimal.
 */
export function parseCsvMoney(valor: string): number | null {
  const texto = valor.replace(/R\$/gi, '').replace(/\s/g, '').trim();
  if (!texto) return null;
  if (!/^-?[\d.,]+$/.test(texto)) return null;

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  let normalizado = texto;
  if (temVirgula && temPonto) {
    // o último separador é o decimal; o outro é milhar
    normalizado = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = texto.replace(',', '.');
  } else if (temPonto) {
    const casas = texto.length - texto.lastIndexOf('.') - 1;
    // "1.234" é mil e duzentos e trinta e quatro; "12.34" é doze e trinta e quatro
    if (casas === 3) normalizado = texto.replace(/\./g, '');
  }
  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100);
}
