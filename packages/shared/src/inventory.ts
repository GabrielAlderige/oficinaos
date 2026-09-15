/**
 * Regras de estoque (docs/ARCHITECTURE.md §10). Quantidades em milésimos,
 * dinheiro em centavos: tudo inteiro. A API usa estas funções para decidir;
 * o painel, para mostrar a mesma conta.
 */

/**
 * Custo médio móvel depois de uma entrada:
 *   novo = (saldo × médio + entrada × custo) / (saldo + entrada)
 * Sem saldo positivo (ou sem médio anterior), o médio passa a ser o custo da entrada.
 * BigInt para não estourar a precisão com estoque grande.
 */
export function weightedAverageCost(input: {
  onHandMilli: number;
  averageCostCents: number | null;
  inMilli: number;
  unitCostCents: number;
}): number {
  const { onHandMilli, averageCostCents, inMilli, unitCostCents } = input;
  if (onHandMilli <= 0 || averageCostCents === null) return unitCostCents;
  const total = BigInt(onHandMilli) * BigInt(averageCostCents) + BigInt(inMilli) * BigInt(unitCostCents);
  const quantity = BigInt(onHandMilli + inMilli);
  return Number((total * 2n + quantity) / (2n * quantity)); // arredonda meio para cima
}

/**
 * Custo médio depois de devolver ao fornecedor (E12). A devolução corrige uma
 * entrada, então tira o valor PELO CUSTO DE ENTRADA daquela compra:
 *   novo = (saldo × médio − saída × custo da entrada) / (saldo − saída)
 * Se nada mexeu no estoque entre receber e devolver, o médio volta exatamente
 * ao de antes. Sem saldo depois da saída, ou com a conta ficando negativa
 * (a peça já saiu por OS a outro custo), mantém o médio vigente.
 */
export function averageCostAfterReturn(input: {
  onHandMilli: number;
  averageCostCents: number | null;
  outMilli: number;
  unitCostCents: number;
}): number | null {
  const { onHandMilli, averageCostCents, outMilli, unitCostCents } = input;
  if (averageCostCents === null) return null;
  const resto = onHandMilli - outMilli;
  if (onHandMilli <= 0 || resto <= 0) return averageCostCents;
  const total = BigInt(onHandMilli) * BigInt(averageCostCents) - BigInt(outMilli) * BigInt(unitCostCents);
  if (total < 0n) return averageCostCents;
  const quantidade = BigInt(resto);
  return Number((total * 2n + quantidade) / (2n * quantidade));
}

/** Preço sugerido = custo × (1 + margem). A oficina sempre pode editar. */
export function suggestedSalePrice(costCents: number, markupBps: number): number {
  return Math.round((costCents * (10_000 + markupBps)) / 10_000);
}

/** Valor do estoque ao custo médio: quantidade (milésimos) × custo. */
export function stockValueCents(onHandMilli: number, averageCostCents: number | null): number {
  if (!averageCostCents || onHandMilli <= 0) return 0;
  return Math.round((onHandMilli * averageCostCents) / 1000);
}

export const STOCK_STATUSES = ['NOT_TRACKED', 'NEGATIVE', 'OUT', 'LOW', 'OK'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  NOT_TRACKED: 'Sem controle',
  NEGATIVE: 'Negativo',
  OUT: 'Sem estoque',
  LOW: 'Abaixo do mínimo',
  OK: 'Em estoque',
};

/**
 * Situação do estoque. Disponível = em estoque − reservado para OS aprovadas.
 * Negativo existe de propósito: a baixa na finalização não trava a entrega
 * do carro (ARCHITECTURE §10); aparece como alerta para ajustar.
 */
export function stockStatus(input: {
  trackStock: boolean;
  onHandMilli: number;
  reservedMilli: number;
  minMilli: number;
}): StockStatus {
  if (!input.trackStock) return 'NOT_TRACKED';
  if (input.onHandMilli < 0) return 'NEGATIVE';
  const available = input.onHandMilli - input.reservedMilli;
  if (available <= 0) return 'OUT';
  if (available < input.minMilli) return 'LOW';
  return 'OK';
}
