import { z } from 'zod';
import { BILLING_CYCLES } from '../billing';
import { PLAN_CODES, SUBSCRIPTION_STATUSES } from '../enums/billing';

export const planSchema = z.object({
  code: z.enum(PLAN_CODES),
  name: z.string(),
  priceMonthlyCents: z.number().int(),
  /** null = a oficina só pode assinar no mensal */
  priceYearlyCents: z.number().int().nullable(),
  limits: z.object({
    maxUsers: z.number().int().nullable(),
    maxWorkOrdersPerMonth: z.number().int().nullable(),
    storageMb: z.number().int().nullable(),
  }),
  features: z.array(z.string()),
  current: z.boolean(),
});
export type PlanOption = z.infer<typeof planSchema>;

export const subscriptionPaymentSchema = z.object({
  id: z.uuid(),
  amountCents: z.number().int(),
  status: z.string(),
  paidAt: z.iso.datetime().nullable(),
  dueDate: z.iso.date(),
  periodStart: z.iso.date().nullable(),
  periodEnd: z.iso.date().nullable(),
  invoiceUrl: z.url().nullable(),
});
export type SubscriptionPayment = z.infer<typeof subscriptionPaymentSchema>;

/** Tudo o que a tela de plano precisa, numa resposta só. */
export const billingOverviewSchema = z.object({
  plan: z.enum(PLAN_CODES),
  planName: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  cycle: z.enum(BILLING_CYCLES),
  priceCents: z.number().int().nullable(),
  trialEndsAt: z.iso.datetime().nullable(),
  currentPeriodEnd: z.iso.datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  /** situação calculada (ver `situacaoDaAssinatura`) */
  emTeste: z.boolean(),
  emCarencia: z.boolean(),
  bloqueada: z.boolean(),
  diasRestantes: z.number().int(),
  trabalhaAte: z.iso.datetime().nullable(),
  /** já existe assinatura no gateway? (senão, o botão é "Assinar") */
  subscribed: z.boolean(),
  /** o gateway: `simulador` não cobra ninguém */
  provider: z.string(),
  environment: z.string(),
  /** a página de pagamento da assinatura no gateway */
  checkoutUrl: z.url().nullable(),
  usage: z.object({
    users: z.number().int(),
    maxUsers: z.number().int().nullable(),
    workOrdersThisMonth: z.number().int(),
    maxWorkOrdersPerMonth: z.number().int().nullable(),
  }),
  plans: z.array(planSchema),
  payments: z.array(subscriptionPaymentSchema),
});
export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export const changePlanSchema = z.object({
  plan: z.enum(PLAN_CODES),
  cycle: z.enum(BILLING_CYCLES).default('MONTHLY'),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const startSubscriptionSchema = changePlanSchema.extend({
  /** rede ruim repete POST: o segundo não assina de novo (D32) */
  clientRequestId: z.uuid(),
});
export type StartSubscriptionInput = z.infer<typeof startSubscriptionSchema>;

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
