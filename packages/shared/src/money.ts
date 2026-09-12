/**
 * Dinheiro trafega e é guardado como inteiro em centavos (ver docs/DATABASE.md §1).
 * Aqui só formatação e leitura do que a pessoa digita; os totais do orçamento
 * ficam em `pricing.ts` (etapa E5).
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const plain = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 124000 → "R$ 1.240,00" (com espaço não separável, como o Intl produz). */
export function formatBRL(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Valor em centavos precisa ser inteiro: ${cents}`);
  }
  return brl.format(cents / 100);
}

/** 124000 → "1.240,00": para preencher um campo de valor. */
export const formatBRLInput = (cents: number): string => plain.format(cents / 100);

/**
 * O que a pessoa digita num campo de valor → centavos.
 * Aceita "1.234,56", "1234,5", "1234", "R$ 12,90". Ponto é SÓ separador de milhar:
 * "12.5" é ambíguo e é recusado (`null`), para ninguém gravar R$ 125 achando que era R$ 12,50.
 */
export function parseBRL(input: string): number | null {
  const text = input.replace(/R\$/i, '').replace(/\s/g, '');
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(text)) return null;
  const [reais = '0', centavos = ''] = text.replace(/\./g, '').split(',');
  return Number(reais) * 100 + Number(centavos.padEnd(2, '0'));
}

/** "30" | "12,5" → basis points (3000, 1250). `null` se inválido. */
export function parsePercent(input: string): number | null {
  const text = input.replace('%', '').trim();
  if (!/^\d{1,4}(,\d{1,2})?$/.test(text)) return null;
  const [whole = '0', fraction = ''] = text.split(',');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

/** 1250 → "12,5". */
export const formatPercentInput = (bps: number): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(bps / 100);
