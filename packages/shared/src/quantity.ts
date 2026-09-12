/**
 * Quantidades com até 3 casas (4,5 L de óleo, 2,35 m de mangueira). No domínio
 * viram INTEIROS em milésimos: somar e comparar sem erro de float
 * (docs/DATABASE.md §1). O banco guarda numeric(12,3) e devolve texto.
 */

const PATTERN = /^-?\d{1,9}([.,]\d{1,3})?$/;

/** "4,5" | "4.5" | 4.5 | "-2" → milésimos (4500, -2000). `null` se não for quantidade válida. */
export function parseQuantity(input: string | number): number | null {
  const text = (typeof input === 'number' ? String(input) : input).trim();
  if (!PATTERN.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', fraction = ''] = text.replace('-', '').split(/[.,]/);
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return negative ? -milli : milli;
}

/** Milésimos → número para a API (4500 → 4.5). Exato: no máximo 3 casas. */
export const milliToNumber = (milli: number): number => milli / 1000;

/** Milésimos → texto para o numeric do banco (4500 → "4.500"). */
export function milliToDecimal(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

const display = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

/** 4500 → "4,5"; com unidade: "4,5 L". */
export function formatQuantity(milli: number, unit?: string): string {
  const text = display.format(milli / 1000);
  return unit ? `${text} ${unit}` : text;
}
