import { z } from 'zod';
import { PLAN_CODES, SUBSCRIPTION_STATUSES } from '../enums/billing';
import { ROLES } from '../enums/roles';
import { PERMISSIONS } from '../permissions';
import { emailSchema, personNameSchema, phoneSchema } from './common';
import { passwordSchema } from './password';

// ---- entrada ----

export const signupSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, 'Informe o nome da oficina').max(120),
  whatsapp: phoneSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha').max(128),
  /** oficina preferida, para quem participa de mais de uma */
  organizationId: z.uuid().optional(),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const switchOrganizationSchema = z.object({ organizationId: z.uuid() });

export const invitationTokenParamsSchema = z.object({ token: z.string().min(20).max(200) });

/**
 * Aceite de convite. Conta nova: nome + senha forte. Conta existente: a senha
 * atual (prova que é a mesma pessoa). A API decide qual caso se aplica.
 */
export const acceptInvitationSchema = z.object({
  token: z.string().min(20).max(200),
  name: personNameSchema.optional(),
  password: z.string().min(1, 'Informe a senha').max(128),
});

// ---- saída ----

export const authUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
});

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(ROLES),
});

export const meSchema = z.object({
  user: authUserSchema,
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    timezone: z.string(),
  }),
  role: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  /** todas as oficinas ativas do usuário, para o seletor */
  organizations: z.array(organizationSummarySchema),
  subscription: z
    .object({
      plan: z.enum(PLAN_CODES),
      planName: z.string(),
      status: z.enum(SUBSCRIPTION_STATUSES),
      trialEndsAt: z.string().nullable(),
    })
    .nullable(),
  sessionId: z.uuid(),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  /** ISO 8601: quando o access token expira */
  expiresAt: z.string(),
  me: meSchema,
});

export const sessionSchema = z.object({
  id: z.uuid(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  ip: z.string().nullable(),
  organizationName: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
});

export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  /** já existe conta com esse e-mail: pede só a senha atual */
  existingAccount: z.boolean(),
  expiresAt: z.string(),
});

export type SignupInput = z.input<typeof signupSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type Me = z.infer<typeof meSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type SessionInfo = z.infer<typeof sessionSchema>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
