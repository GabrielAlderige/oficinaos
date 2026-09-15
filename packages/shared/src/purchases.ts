/**
 * Regras de compra (E12). Quantidade em milésimos, dinheiro em centavos, tudo
 * inteiro — a API decide com estas funções e o painel mostra a mesma conta.
 */
import type { PurchaseOrderStatus } from './enums/purchases';

export const PURCHASE_ACTIONS = ['edit', 'order', 'receive', 'close', 'cancel', 'return'] as const;
export type PurchaseAction = (typeof PURCHASE_ACTIONS)[number];

const ACTION_FROM: Record<PurchaseAction, readonly PurchaseOrderStatus[]> = {
  // rascunho é o único momento em que as linhas mudam: depois de pedido, o
  // fornecedor está separando exatamente aquilo
  edit: ['DRAFT'],
  order: ['DRAFT'],
  receive: ['ORDERED', 'PARTIAL'],
  // "encerrar o que falta": só faz sentido se algo chegou; sem nada, é cancelar
  close: ['PARTIAL'],
  // cancelar só sem nada recebido — com peça no estoque, corrigir é devolver
  cancel: ['DRAFT', 'ORDERED'],
  return: ['PARTIAL', 'RECEIVED'],
};

export function canPurchaseAction(status: PurchaseOrderStatus, action: PurchaseAction): boolean {
  return ACTION_FROM[action].includes(status);
}

interface LinhaRecebida {
  quantityMilli: number;
  receivedMilli: number;
  returnedMilli: number;
}

/** O que ficou de verdade: chegou menos o que voltou ao fornecedor. */
export const netReceivedMilli = (line: { receivedMilli: number; returnedMilli: number }): number =>
  line.receivedMilli - line.returnedMilli;

/**
 * Situação depois de receber ou devolver, pelo LÍQUIDO de cada linha: tudo
 * ficou → RECEIVED; parte → PARTIAL; nada → ORDERED. Devolver a peça errada
 * reabre a espera pela certa.
 */
export function statusAfterReceipt(lines: readonly LinhaRecebida[]): PurchaseOrderStatus {
  if (!lines.some((line) => netReceivedMilli(line) > 0)) return 'ORDERED';
  return lines.every((line) => netReceivedMilli(line) >= line.quantityMilli) ? 'RECEIVED' : 'PARTIAL';
}

/** Valor da linha: quantidade × custo, com o centavo meio para cima. */
export function lineValueCents(quantityMilli: number, unitCostCents: number): number {
  return Math.round((quantityMilli * unitCostCents) / 1000);
}

export function purchaseOrderTotals(
  lines: readonly { quantityMilli: number; unitCostCents: number }[],
  shippingCents: number,
): { itemsTotalCents: number; shippingCents: number; totalCents: number } {
  const itemsTotalCents = lines.reduce((soma, line) => soma + lineValueCents(line.quantityMilli, line.unitCostCents), 0);
  return { itemsTotalCents, shippingCents, totalCents: itemsTotalCents + shippingCents };
}

/**
 * Rateio do frete pelo valor de cada linha (decisão de 14/09/2026): a peça cara
 * carrega mais frete que o parafuso. Maior resto nos centavos, então a soma
 * das partes é EXATAMENTE o frete. Se todas as linhas valem zero (brinde),
 * divide igual.
 */
export function allocateFreight(lineValues: readonly number[], freightCents: number): number[] {
  if (!lineValues.length) return [];
  if (freightCents <= 0) return lineValues.map(() => 0);
  const pesos = lineValues.some((valor) => valor > 0) ? lineValues.map((valor) => Math.max(0, valor)) : lineValues.map(() => 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  const partes = pesos.map((peso, indice) => {
    const exato = (freightCents * peso) / total;
    return { indice, inteiro: Math.floor(exato), resto: exato - Math.floor(exato) };
  });
  let sobra = freightCents - partes.reduce((soma, parte) => soma + parte.inteiro, 0);
  // maior resto primeiro; empate vai para a linha que vem antes (estável)
  for (const parte of [...partes].sort((a, b) => b.resto - a.resto || a.indice - b.indice)) {
    if (sobra <= 0) break;
    parte.inteiro += 1;
    sobra -= 1;
  }
  return partes.map((parte) => parte.inteiro);
}

/**
 * Custo que entra no estoque: preço da nota + a parte do frete, por unidade.
 * Arredonda no centavo; em quantidade fracionada ou frete indivisível pode
 * sobrar menos de um centavo por unidade, que é o limite de guardar centavo inteiro.
 */
export function landedUnitCostCents(quantityMilli: number, unitCostCents: number, freightCents: number): number {
  if (quantityMilli <= 0) return unitCostCents;
  return unitCostCents + Math.round((freightCents * 1000) / quantityMilli);
}

/** Quanto ainda falta chegar na linha (o que foi devolvido volta a faltar). */
export const remainingMilli = (line: LinhaRecebida): number => Math.max(0, line.quantityMilli - netReceivedMilli(line));

/** Quanto ainda pode voltar ao fornecedor: o que chegou menos o que já voltou. */
export const returnableMilli = (line: { receivedMilli: number; returnedMilli: number }): number =>
  Math.max(0, line.receivedMilli - line.returnedMilli);

/**
 * Quanto comprar para repor o estoque mínimo (sugestão de compra, E12):
 *   mínimo − (disponível + o que já está pedido e ainda não chegou)
 * Peça sem mínimo definido não entra: o catálogo inteiro sem estoque não é
 * lista de compras. Devolve null quando não há o que repor.
 */
export function suggestedRestockMilli(input: {
  minMilli: number;
  onHandMilli: number;
  reservedMilli: number;
  incomingMilli: number;
}): number | null {
  if (input.minMilli <= 0) return null;
  const falta = input.minMilli - (input.onHandMilli - input.reservedMilli + input.incomingMilli);
  return falta > 0 ? falta : null;
}
