import { z } from 'zod';
import { ROLES } from '../enums/roles';
import { emailSchema } from './common';

/**
 * Cores do mecânico na agenda. Paleta fechada de propósito: tom escolhido a
 * dedo some no tema escuro ou fica ilegível com o texto por cima.
 */
export const CALENDAR_COLORS = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#9333ea',
  '#0891b2',
  '#dc2626',
  '#ca8a04',
  '#4f46e5',
] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  isCurrentUser: z.boolean(),
  /** cor na agenda; nulo = a agenda escolhe uma pelo id */
  calendarColor: z.string().nullable(),
  joinedAt: z.string(),
});

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ROLES),
  invitedByName: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ROLES),
});

/** Só na criação o link sai por inteiro: dá para mandar pelo WhatsApp na hora. */
export const createdInvitationSchema = invitationSchema.extend({ inviteUrl: z.string() });

export const updateMemberSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    calendarColor: z.enum(CALENDAR_COLORS).nullable().optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.isActive !== undefined || v.calendarColor !== undefined,
    'Nada para alterar',
  );

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
export type UpdateMemberInput = z.output<typeof updateMemberSchema>;
