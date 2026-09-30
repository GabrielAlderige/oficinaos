/**
 * Os planos têm nome de preparação de motor (E38): quem compra é dono de
 * oficina, e a ordem Turbo → Supercharger → Nitro dispensa explicação.
 */
export const PLAN_CODES = ['TURBO', 'SUPERCHARGER', 'NITRO'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** `null` = ilimitado. Os valores ficam na tabela `plans` (mudar plano é mudar dado). */
export interface PlanLimits {
  maxUsers: number | null;
  maxWorkOrdersPerMonth: number | null;
  storageMb: number | null;
}

/**
 * Cadastro novo entra neste plano, em teste, por este tempo.
 *
 * O teste é no plano **mais alto** de propósito (mudou na E40). Enquanto os
 * planos eram enfeite isso não fazia diferença — todo mundo tinha tudo. Agora
 * que a API barra de verdade, entrar no Supercharger significaria terminar os
 * 14 dias sem nunca ter visto a pesquisa de peças, o WhatsApp oficial nem as
 * automações: exatamente as três coisas que justificam o Nitro. Ninguém paga
 * por aquilo que não experimentou.
 *
 * A contrapartida é honesta e tem de estar na tela: ao assinar um plano menor
 * a oficina perde o que não está nele. Por isso a tela de planos marca o que o
 * teste inclui, e a de bloqueio diz em qual plano a funcionalidade mora.
 */
export const TRIAL_PLAN: PlanCode = 'NITRO';
export const TRIAL_DAYS = 14;
