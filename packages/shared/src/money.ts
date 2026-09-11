/**
 * Dinheiro trafega e é guardado como inteiro em centavos (ver docs/DATABASE.md §1).
 * Este módulo só formata; o cálculo de totais mora em `pricing.ts` (etapa E5).
 */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 124000 → "R$ 1.240,00" (com espaço não separável, como o Intl produz). */
export function formatBRL(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Valor em centavos precisa ser inteiro: ${cents}`);
  }
  return brl.format(cents / 100);
}
