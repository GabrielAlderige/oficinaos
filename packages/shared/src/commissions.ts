/**
 * Comissão do mecânico (E26).
 *
 * Três decisões do dono do produto viraram estas regras:
 *
 * 1. **O percentual vem em três níveis** e o mais específico vence:
 *    serviço → mecânico → oficina. Assim dá para pagar mais pela retífica sem
 *    ter de configurar linha por linha, e a oficina que quer um número só
 *    preenche um número só.
 * 2. **Comissão é sobre mão de obra.** Peça revendida não gera comissão: quem
 *    ganha na peça é a oficina, que comprou, guardou e assumiu o risco.
 * 3. **Ganha quando o cliente paga**, proporcional ao que entrou. Oficina não
 *    paga comissão de fiado que não voltou — e pagamento pela metade gera
 *    metade da comissão.
 *
 * O percentual usado fica **congelado no item** quando a OS é finalizada: se
 * a oficina mudar a tabela em março, a comissão de fevereiro não muda junto.
 */

/** Basis points: 1250 = 12,5%. O resto do sistema já fala assim (D3). */
export const BPS = 10_000;

export interface NiveisDeComissao {
  /** o do serviço do catálogo; null = não tem regra própria */
  servicoBps?: number | null;
  /** o do mecânico; null = não tem regra própria */
  mecanicoBps?: number | null;
  /** o padrão da oficina */
  oficinaBps: number;
}

/** O percentual que vale para este item: o mais específico que existir. */
export function percentualDaComissao(niveis: NiveisDeComissao): number {
  if (niveis.servicoBps !== null && niveis.servicoBps !== undefined) return niveis.servicoBps;
  if (niveis.mecanicoBps !== null && niveis.mecanicoBps !== undefined) return niveis.mecanicoBps;
  return niveis.oficinaBps;
}

/** De onde veio o percentual — a tela mostra isso para ninguém ficar adivinhando. */
export type OrigemDaComissao = 'SERVICE' | 'MECHANIC' | 'ORGANIZATION';

export function origemDaComissao(niveis: NiveisDeComissao): OrigemDaComissao {
  if (niveis.servicoBps !== null && niveis.servicoBps !== undefined) return 'SERVICE';
  if (niveis.mecanicoBps !== null && niveis.mecanicoBps !== undefined) return 'MECHANIC';
  return 'ORGANIZATION';
}

export const ORIGEM_DA_COMISSAO_LABELS: Record<OrigemDaComissao, string> = {
  SERVICE: 'percentual do serviço',
  MECHANIC: 'percentual do mecânico',
  ORGANIZATION: 'percentual padrão da oficina',
};

/** A comissão de um item de serviço, arredondada ao centavo. */
export const comissaoDoItemCents = (baseCents: number, bps: number): number =>
  Math.round((Math.max(0, baseCents) * Math.max(0, bps)) / BPS);

/**
 * Quanto de uma comissão já foi ganho, dado o que o cliente pagou.
 *
 * `devidoCents` é o total da OS; `pagoCents`, o que entrou. A fração nunca
 * passa de 1: cliente que pagou a mais (troco, crédito) não gera comissão
 * extra, e OS de valor zero não gera comissão nenhuma.
 */
export function comissaoGanhaCents(comissaoTotalCents: number, pagoCents: number, devidoCents: number): number {
  if (devidoCents <= 0 || pagoCents <= 0) return 0;
  const fracao = Math.min(1, pagoCents / devidoCents);
  return Math.round(comissaoTotalCents * fracao);
}

export interface ItemComissionavel {
  /** o valor do item na OS, já com desconto */
  totalCents: number;
  /** o percentual congelado quando a OS foi finalizada; null = sem comissão */
  commissionBps: number | null;
  /** de quem é a comissão; null = ninguém marcado, então não gera */
  mechanicUserId: string | null;
}

/**
 * A comissão de uma OS, por mecânico. Uma OS pode ter serviços de duas
 * pessoas — o que troca o óleo e o que faz o alinhamento — e cada uma recebe
 * pelo que fez.
 */
export function comissaoPorMecanico(itens: ItemComissionavel[]): Map<string, number> {
  const porMecanico = new Map<string, number>();
  for (const item of itens) {
    if (!item.mechanicUserId || item.commissionBps === null || item.commissionBps <= 0) continue;
    const valor = comissaoDoItemCents(item.totalCents, item.commissionBps);
    if (valor <= 0) continue;
    porMecanico.set(item.mechanicUserId, (porMecanico.get(item.mechanicUserId) ?? 0) + valor);
  }
  return porMecanico;
}

/** Percentual em texto: 1250 → "12,5%". */
export const formatBps = (bps: number): string =>
  `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** "12,5" digitado na tela → 1250. Vírgula ou ponto, os dois servem. */
export function parseBps(texto: string): number | null {
  const limpo = texto.trim().replace('%', '').replace(',', '.');
  if (!limpo) return null;
  const numero = Number(limpo);
  if (!Number.isFinite(numero) || numero < 0 || numero > 100) return null;
  return Math.round(numero * 100);
}
