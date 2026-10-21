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

/**
 * A oferta "Oficina Pronta" (D92, 20/10/2026): o teste é de 30 dias e só começa
 * a contar quando o sistema está de pé — na implantação feita pela equipe ou
 * no primeiro orçamento enviado, o que vier antes.
 *
 * Os 14 dias contados do cadastro perdiam a oficina na tela vazia: o dono
 * abria, não via nada dele ali e desistia antes de mandar o primeiro
 * orçamento. Gastar o relógio enquanto ninguém usa é cobrar pelo vazio.
 *
 * Para a conta não ficar parada esperando para sempre, o teste começa sozinho
 * `TRIAL_AUTOSTART_DAYS` depois do cadastro. Por isso o cadastro já grava o
 * fim mais distante possível (15 + 30 dias) e o início de verdade só ENCURTA
 * esse fim — nunca estica (ver `iniciarTeste`).
 */
export const TRIAL_DAYS = 30;
export const TRIAL_AUTOSTART_DAYS = 15;

/**
 * Fundadoras (D92): as 10 primeiras oficinas, escolhidas pela equipe. Ganham 3
 * meses grátis e depois o Nitro a R$ 279 por 12 meses, em troca de uso de
 * verdade, depoimento e indicação. Não é plano novo: é o Nitro com o preço
 * travado na assinatura, que já guarda o preço congelado (`priceCents`).
 */
export const FOUNDER_SLOTS = 10;
export const FOUNDER_TRIAL_DAYS = 90;
export const FOUNDER_PRICE_CENTS = 27_900;
export const FOUNDER_PRICE_MONTHS = 12;
export const FOUNDER_PLAN: PlanCode = 'NITRO';

/** O WhatsApp oficial da equipe: é para onde vai quem pede a implantação grátis. */
export const SUPPORT_WHATSAPP = '5535997558675';
