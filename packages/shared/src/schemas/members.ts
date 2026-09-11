import { z } from 'zod';
import { ROLES } from '../enums/roles';
import { emailSchema } from './common';

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  isActive: z.boolean(),
  isCurrentUser: z.boolean(),
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
  })
  .refine((v) => v.role !== undefined || v.isActive !== undefined, 'Nada para alterar');

export type Member = z.infer<typeof memberSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
