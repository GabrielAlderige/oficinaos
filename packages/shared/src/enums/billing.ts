export const PLAN_CODES = ['STARTER', 'PROFESSIONAL', 'BUSINESS'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** `null` = ilimitado. Os valores ficam na tabela `plans` (mudar plano é mudar dado). */
export interface PlanLimits {
  maxUsers: number | null;
  maxWorkOrdersPerMonth: number | null;
  storageMb: number | null;
}

/** Cadastro novo entra neste plano, em teste, por este tempo. */
export const TRIAL_PLAN: PlanCode = 'PROFESSIONAL';
export const TRIAL_DAYS = 14;
