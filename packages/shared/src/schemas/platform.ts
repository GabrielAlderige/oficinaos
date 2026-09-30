import { z } from 'zod';
import { PLAN_CODES, SUBSCRIPTION_STATUSES } from '../enums/billing';

/**
 * A área da PLATAFORMA sobre as oficinas (E41).
 *
 * Existe por um motivo operacional concreto: não havia nenhuma forma de
 * estender o teste de uma oficina sem abrir o Postgres de produção e escrever
 * SQL na mão. Piloto com preço de fundador precisa de 60 ou 90 dias, não de
 * 14 — e isso não pode custar uma conexão no banco vivo, sem registro de quem
 * fez nem por quê.
 */
export const platformOrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  document: z.string().nullable(),
  email: z.string().nullable(),
  whatsapp: z.string().nullable(),
  createdAt: z.string(),
  /** quantas pessoas ativas: o sinal mais direto de que a oficina entrou de verdade */
  activeUsers: z.number().int(),
  plan: z.enum(PLAN_CODES),
  planName: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  trialEndsAt: z.string().nullable(),
  subscribed: z.boolean(),
  /** calculado, igual à tela da oficina: em teste, em carência ou bloqueada */
  emTeste: z.boolean(),
  emCarencia: z.boolean(),
  bloqueada: z.boolean(),
  diasRestantes: z.number().int(),
});
export type PlatformOrganization = z.infer<typeof platformOrganizationSchema>;

export const platformOverviewSchema = z.object({
  organizations: z.array(platformOrganizationSchema),
  total: z.number().int(),
  emTeste: z.number().int(),
  assinantes: z.number().int(),
  bloqueadas: z.number().int(),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

/**
 * Estender o teste. O motivo é OBRIGATÓRIO: daqui a seis meses, olhando a
 * trilha de auditoria, "estendeu 60 dias" sem motivo não explica nada — e é
 * exatamente o registro que evita o favor virar regra sem ninguém perceber.
 */
export const extendTrialSchema = z.object({
  days: z
    .number()
    .int()
    .min(1, 'Pelo menos 1 dia')
    .max(180, 'No máximo 180 dias: acima disso é plano de cortesia, não teste'),
  reason: z.string().trim().min(3, 'Diga o motivo').max(200),
});
export type ExtendTrialInput = z.infer<typeof extendTrialSchema>;
