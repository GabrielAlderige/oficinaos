import type { z } from 'zod';
import {
  canManageRole,
  type CreatedInvitation,
  type createInvitationSchema,
  ErrorCode,
  type Invitation,
  type Member,
  ROLE_LABELS,
  type updateMemberSchema,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import { type AuthContext, type ClientInfo, membershipKey, type ServiceDeps } from '../../core/auth-context';
import { AppError, forbidden, notFound } from '../../core/errors';
import { revokeSessions } from '../../core/sessions';
import { withTenant } from '../../db/tenant';
import { INVITATION_TTL_MS } from '../auth/auth.constants';
import { randomToken, sha256 } from '../auth/tokens';
import * as repo from './members.repository';

type CreateInvitationInput = z.output<typeof createInvitationSchema>;
type UpdateMemberInput = z.output<typeof updateMemberSchema>;

const cannotChangeSelf = () =>
  forbidden('Você não pode alterar o seu próprio acesso. Peça a outro administrador.');

export class MembersService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext): Promise<Member[]> {
    const rows = await withTenant(this.deps.db, auth, (tx) => repo.listMembers(tx, auth.organizationId));
    return rows.map((row) => ({
      ...row,
      joinedAt: row.joinedAt.toISOString(),
      isCurrentUser: row.userId === auth.userId,
    }));
  }

  async listInvitations(auth: AuthContext): Promise<Invitation[]> {
    const rows = await withTenant(this.deps.db, auth, (tx) =>
      repo.listPendingInvitations(tx, auth.organizationId, new Date()),
    );
    return rows.map((row) => ({
      ...row,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Cria o convite e devolve o link inteiro UMA vez: a oficina costuma mandar
   * pelo WhatsApp na hora. O e-mail sai também (driver console em dev).
   */
  async invite(auth: AuthContext, input: CreateInvitationInput, client: ClientInfo): Promise<CreatedInvitation> {
    if (!canManageRole(auth.role, input.role)) throw forbidden('Só o dono da oficina pode convidar outro dono.');
    const { db, env } = this.deps;
    const token = randomToken();

    const { invitation, organizationName, inviterName } = await withTenant(db, auth, async (tx) => {
      if (await repo.findActiveMemberByEmail(tx, auth.organizationId, input.email)) {
        throw new AppError(409, ErrorCode.ALREADY_MEMBER, 'Já faz parte da equipe', `${input.email} já faz parte da equipe.`);
      }
      // reenviar para o mesmo e-mail invalida o link anterior (e libera a vaga dele)
      await repo.revokePendingInvitationsForEmail(tx, auth.organizationId, input.email);

      const plan = await repo.findPlanLimits(tx, auth.organizationId);
      const maxUsers = plan?.limits.maxUsers ?? null;
      if (maxUsers !== null && (await repo.countSeats(tx, auth.organizationId, new Date())) >= maxUsers) {
        throw new AppError(
          403,
          ErrorCode.PLAN_LIMIT_REACHED,
          'Limite de usuários do plano',
          `O plano ${plan?.planName} permite até ${maxUsers} usuários, contando convites pendentes.`,
        );
      }

      const invitation = await repo.insertInvitation(tx, {
        organizationId: auth.organizationId,
        email: input.email,
        role: input.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        invitedByUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'invitation.created',
        entityType: 'invitation',
        entityId: invitation.id,
        metadata: { email: input.email, role: input.role },
        ...client,
      });
      return {
        invitation,
        organizationName: await repo.findOrganizationName(tx, auth.organizationId),
        inviterName: await repo.findUserName(tx, auth.userId),
      };
    });

    const inviteUrl = `${env.APP_URL}/convite/${token}`;
    try {
      await this.deps.email.send({
        to: input.email,
        subject: `Convite para a equipe da ${organizationName}`,
        text:
          `${inviterName ?? 'A oficina'} convidou você para a equipe da ${organizationName} no OficinaOS, ` +
          `como ${ROLE_LABELS[input.role]}.\n\n` +
          `Para aceitar, abra o link abaixo (vale por 7 dias):\n\n${inviteUrl}\n`,
      });
    } catch (err) {
      this.deps.log.error({ err }, 'falha ao enviar e-mail de convite');
    }

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      invitedByName: inviterName,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
      inviteUrl,
    };
  }

  async revokeInvitation(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const revoked = await repo.revokeInvitation(tx, auth.organizationId, id);
      if (!revoked) throw notFound('Convite não encontrado ou já usado.');
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: id,
        metadata: { email: revoked.email },
        ...client,
      });
    });
  }

  /** Mudar papel ou desativar. Desativar derruba as sessões da pessoa nesta oficina na hora. */
  async update(auth: AuthContext, id: string, input: UpdateMemberInput, client: ClientInfo): Promise<Member> {
    const { db, caches } = this.deps;
    // trocar a PRÓPRIA cor na agenda é permitido: não mexe em acesso nenhum
    const soCor = input.role === undefined && input.isActive === undefined;
    const { member, patch, revoked } = await withTenant(db, auth, async (tx) => {
      const member = await this.loadManageable(tx, auth, id, soCor);
      if (input.role && !canManageRole(auth.role, input.role)) {
        throw forbidden('Só o dono da oficina pode tornar alguém dono.');
      }
      const losesOwner =
        member.role === 'OWNER' &&
        member.isActive &&
        ((input.role !== undefined && input.role !== 'OWNER') || input.isActive === false);
      if (losesOwner) await this.assertNotLastOwner(tx, auth.organizationId);

      const patch = { role: input.role, isActive: input.isActive, calendarColor: input.calendarColor };
      const changes = diffChanges(member, patch);
      let revoked: string[] = [];
      if (Object.keys(changes).length) {
        await repo.updateMember(tx, member.id, patch);
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'member.updated',
          entityType: 'membership',
          entityId: member.id,
          changes,
          metadata: { email: member.email },
          ...client,
        });
        if (input.isActive === false) {
          revoked = await revokeSessions(
            tx,
            { userId: member.userId, organizationId: auth.organizationId },
            'MEMBERSHIP_INACTIVE',
          );
        }
      }
      return { member, patch, revoked };
    });

    caches.memberships.delete(membershipKey(auth.organizationId, member.userId));
    revoked.forEach((sessionId) => caches.sessions.delete(sessionId));

    return {
      id: member.id,
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: patch.role ?? member.role,
      isActive: patch.isActive ?? member.isActive,
      // `??` cairia no valor antigo quando a pessoa LIMPA a cor (null explícito)
      calendarColor: patch.calendarColor !== undefined ? patch.calendarColor : member.calendarColor,
      isCurrentUser: member.userId === auth.userId,
      joinedAt: member.joinedAt.toISOString(),
    };
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    const { db, caches } = this.deps;
    const { member, revoked } = await withTenant(db, auth, async (tx) => {
      const member = await this.loadManageable(tx, auth, id);
      if (member.role === 'OWNER' && member.isActive) await this.assertNotLastOwner(tx, auth.organizationId);

      await repo.deleteMember(tx, member.id);
      const revoked = await revokeSessions(
        tx,
        { userId: member.userId, organizationId: auth.organizationId },
        'MEMBERSHIP_REMOVED',
      );
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'member.removed',
        entityType: 'membership',
        entityId: member.id,
        metadata: { email: member.email, name: member.name, role: member.role },
        ...client,
      });
      return { member, revoked };
    });

    caches.memberships.delete(membershipKey(auth.organizationId, member.userId));
    revoked.forEach((sessionId) => caches.sessions.delete(sessionId));
  }

  /** Membro desta oficina que QUEM PEDE pode gerenciar (outra oficina = 404). */
  private async loadManageable(
    tx: Parameters<Parameters<typeof withTenant>[2]>[0],
    auth: AuthContext,
    id: string,
    permitirSiMesmo = false,
  ) {
    const member = await repo.findMember(tx, auth.organizationId, id);
    if (!member) throw notFound('Membro não encontrado.');
    if (member.userId === auth.userId && !permitirSiMesmo) throw cannotChangeSelf();
    if (!canManageRole(auth.role, member.role)) throw forbidden('Só o dono da oficina pode alterar outro dono.');
    return member;
  }

  private async assertNotLastOwner(tx: Parameters<Parameters<typeof withTenant>[2]>[0], organizationId: string) {
    if ((await repo.countActiveOwners(tx, organizationId)) <= 1) {
      throw new AppError(409, ErrorCode.LAST_OWNER, 'Último dono', 'A oficina precisa de pelo menos um dono ativo.');
    }
  }
}
