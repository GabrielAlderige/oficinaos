/**
 * Regras puras da assinatura do SaaS (V3, E20). Mesma razão do `fiscal.ts` e
 * do `charges.ts`: a mesma conta aparece na tela (quanto falta do teste), na
 * API (quem pode escrever) e no aviso do gateway (renovou, atrasou).
 */

import { addDays } from './calendar';
import type { SubscriptionStatus } from './enums/billing';

/** Cobrança mensal ou anual. O anual só existe se o plano tiver preço anual. */
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

/**
 * Depois que o pagamento atrasa, a oficina ainda trabalha por estes dias.
 * Cortar no minuto seguinte ao vencimento é cortar a oficina no meio de uma
 * OS por causa de um boleto que o banco compensa amanhã.
 */
export const GRACE_DAYS = 7;

/** O que a tela mostra, e o que a API usa para decidir se ainda pode escrever. */
export interface SituacaoDaAssinatura {
  status: SubscriptionStatus;
  /** está no período de teste */
  emTeste: boolean;
  /** pagamento atrasado, mas ainda dentro da carência */
  emCarencia: boolean;
  /** acabou a carência: só leitura, até pagar */
  bloqueada: boolean;
  /** dias que faltam do teste ou da carência (0 quando não se aplica) */
  diasRestantes: number;
  /** até quando a oficina continua trabalhando sem pagar */
  trabalhaAte: string | null;
}

const dia = 86_400_000;
const diasEntre = (de: Date, ate: Date): number => Math.max(0, Math.ceil((ate.getTime() - de.getTime()) / dia));

export interface AssinaturaParaSituacao {
  status: SubscriptionStatus;
  trialEndsAt: Date | string | null;
  currentPeriodEnd: Date | string | null;
  /** quando o pagamento venceu sem entrar */
  pastDueSince: Date | string | null;
}

const data = (valor: Date | string | null): Date | null =>
  valor === null ? null : valor instanceof Date ? valor : new Date(valor);

/**
 * A situação real da assinatura, calculada — não gravada. Gravar "bloqueada"
 * exigiria um job varrendo a tabela toda madrugada só para a tela ficar certa,
 * e ela ficaria errada entre a meia-noite e o job. É a mesma escolha da conta
 * vencida (D31) e da cotação vencida.
 */
export function situacaoDaAssinatura(
  assinatura: AssinaturaParaSituacao,
  agora: Date = new Date(),
): SituacaoDaAssinatura {
  const fimDoTeste = data(assinatura.trialEndsAt);
  const atrasoDesde = data(assinatura.pastDueSince);
  const fimDoPeriodo = data(assinatura.currentPeriodEnd);

  if (assinatura.status === 'TRIALING' && fimDoTeste) {
    const acabou = fimDoTeste.getTime() <= agora.getTime();
    return {
      status: 'TRIALING',
      emTeste: !acabou,
      emCarencia: false,
      bloqueada: acabou,
      diasRestantes: diasEntre(agora, fimDoTeste),
      trabalhaAte: fimDoTeste.toISOString(),
    };
  }

  if (assinatura.status === 'PAST_DUE' && atrasoDesde) {
    const fimDaCarencia = new Date(atrasoDesde.getTime() + GRACE_DAYS * dia);
    const dentro = fimDaCarencia.getTime() > agora.getTime();
    return {
      status: 'PAST_DUE',
      emTeste: false,
      emCarencia: dentro,
      bloqueada: !dentro,
      diasRestantes: diasEntre(agora, fimDaCarencia),
      trabalhaAte: fimDaCarencia.toISOString(),
    };
  }

  if (assinatura.status === 'CANCELED') {
    // cancelou: trabalha até o fim do período que já pagou
    const dentro = fimDoPeriodo !== null && fimDoPeriodo.getTime() > agora.getTime();
    return {
      status: 'CANCELED',
      emTeste: false,
      emCarencia: false,
      bloqueada: !dentro,
      diasRestantes: fimDoPeriodo ? diasEntre(agora, fimDoPeriodo) : 0,
      trabalhaAte: fimDoPeriodo?.toISOString() ?? null,
    };
  }

  const bloqueada = assinatura.status === 'EXPIRED';
  return {
    status: assinatura.status,
    emTeste: false,
    emCarencia: false,
    bloqueada,
    diasRestantes: assinatura.status === 'ACTIVE' && fimDoPeriodo ? diasEntre(agora, fimDoPeriodo) : 0,
    trabalhaAte: fimDoPeriodo?.toISOString() ?? null,
  };
}

/**
 * Bloqueio é só de ESCRITA, e nunca do que resolve o bloqueio. A oficina
 * bloqueada continua lendo tudo o que é dela — cliente, OS, histórico — e
 * continua conseguindo pagar. Trancar os dados de quem atrasou um boleto é
 * sequestro de dado, não cobrança.
 */
export function bloqueiaEscrita(situacao: SituacaoDaAssinatura): boolean {
  return situacao.bloqueada;
}

/** Quanto custa o plano no ciclo escolhido; `null` quando o ciclo não existe. */
export function precoDoCiclo(
  plano: { priceMonthlyCents: number; priceYearlyCents: number | null },
  ciclo: BillingCycle,
): number | null {
  return ciclo === 'MONTHLY' ? plano.priceMonthlyCents : plano.priceYearlyCents;
}

/** O próximo vencimento a partir de hoje, no ciclo escolhido. */
export function proximoVencimento(hoje: string, ciclo: BillingCycle): string {
  return addDays(hoje, ciclo === 'MONTHLY' ? 30 : 365);
}

/** Quanto por mês sai o anual, para a tela comparar com honestidade. */
export function mensalEquivalente(precoAnualCents: number): number {
  return Math.round(precoAnualCents / 12);
}
