import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';
import {
  type acceptInvitationSchema,
  type AuthResponse,
  ErrorCode,
  type InvitationPreview,
  type loginSchema,
  type Me,
  passwordSchema,
  permissionsFor,
  type SessionInfo,
  type signupSchema,
  TRIAL_DAYS,
  TRIAL_PLAN,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import {
  type ClientInfo,
  type MembershipState,
  membershipKey,
  type ServiceDeps,
} from '../../core/auth-context';
import {
  AppError,
  type FieldError,
  notFound,
  pgErrorCode,
  unauthorized,
  UNIQUE_VIOLATION,
  validationFailed,
} from '../../core/errors';
import { revokeSessions } from '../../core/sessions';
import { withInviteToken, withoutTenant, withTenant, withUser } from '../../db/tenant';
import {
  PASSWORD_RESET_TTL_MS,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants';
import * as repo from './auth.repository';
import { burnPasswordCheck, hashPassword, verifyPassword } from './password';
import { randomToken, sha256 } from './tokens';

/** Resposta de login + o refresh token, que só vai para o cookie (nunca no corpo). */
export interface AuthResult extends AuthResponse {
  refreshToken: string | null;
}

interface SessionRef {
  userId: string;
  organizationId: string;
  sessionId: string;
}

const invalidCredentials = () =>
  new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha incorretos', 'Confira o e-mail e a senha.');

const invalidInvitation = () =>
  new AppError(
    400,
    ErrorCode.TOKEN_INVALID,
    'Convite inválido',
    'Este convite é inválido, expirou ou já foi usado. Peça um novo ao responsável pela oficina.',
  );

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export class AuthService {
  constructor(private readonly deps: ServiceDeps) {}

  // ---------------------------------------------------------------- cadastro

  /** Cria usuário, oficina, vínculo de dono e assinatura em teste, numa transação só. */
  async signup(input: z.output<typeof signupSchema>, client: ClientInfo): Promise<AuthResult> {
    const { db } = this.deps;
    const passwordHash = await hashPassword(input.password);
    const userId = uuidv7();
    const organizationId = uuidv7();

    try {
      await withTenant(db, { organizationId, userId }, async (tx) => {
        await repo.insertUser(tx, {
          id: userId,
          name: input.name,
          email: input.email,
          passwordHash,
          phone: input.whatsapp,
        });
        await repo.insertOrganization(tx, {
          id: organizationId,
          name: input.organizationName,
          whatsapp: input.whatsapp,
        });
        await repo.insertMembership(tx, { organizationId, userId, role: 'OWNER' });
        await repo.insertDefaultPartCategories(tx, organizationId);
        await repo.insertDefaultFinancialCategories(tx, organizationId);

        const plan = await repo.findPlanByCode(tx, TRIAL_PLAN);
        if (!plan) throw new Error(`Plano ${TRIAL_PLAN} não existe: rode as migrations`);
        await repo.insertSubscription(tx, {
          organizationId,
          planId: plan.id,
          status: 'TRIALING',
          trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000),
        });

        await recordActivity(tx, {
          organizationId,
          actorUserId: userId,
          action: 'organization.created',
          entityType: 'organization',
          entityId: organizationId,
          ...client,
        });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        throw new AppError(
          409,
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'E-mail já cadastrado',
          'Já existe uma conta com este e-mail. Entre ou recupere a senha.',
        );
      }
      throw err;
    }

    return this.startSession(userId, organizationId, client);
  }

  // ------------------------------------------------------------------- login

  async login(input: z.output<typeof loginSchema>, client: ClientInfo): Promise<AuthResult> {
    const { db } = this.deps;
    const user = await withoutTenant(db, (tx) => repo.findUserByEmail(tx, input.email));
    if (!user) {
      await burnPasswordCheck(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) throw invalidCredentials();

    const organizations = await withUser(db, user.id, (tx) => repo.listUserMemberships(tx, user.id));
    const chosen =
      organizations.find((o) => o.organizationId === input.organizationId) ?? organizations[0];
    if (!chosen) {
      throw new AppError(
        403,
        ErrorCode.NO_ACTIVE_MEMBERSHIP,
        'Sem acesso a nenhuma oficina',
        'Sua conta não está ativa em nenhuma oficina. Fale com o responsável.',
      );
    }

    await withTenant(db, { organizationId: chosen.organizationId, userId: user.id }, async (tx) => {
      await repo.touchLastLogin(tx, user.id);
      await recordActivity(tx, {
        organizationId: chosen.organizationId,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
        ...client,
      });
    });

    return this.startSession(user.id, chosen.organizationId, client);
  }

  // ----------------------------------------------------------------- refresh

  /**
   * Rotação do refresh token com detecção de reuso (ARCHITECTURE §6):
   * - token atual → troca por um novo;
   * - token anterior dentro da tolerância (duas abas) → novo access token, cookie intacto;
   * - token anterior fora da tolerância → alguém copiou o token: a sessão cai.
   */
  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<AuthResult> {
    if (!rawToken) throw unauthorized('Sua sessão expirou. Entre novamente.');
    const { db, caches, log } = this.deps;
    const hash = sha256(rawToken);
    const now = new Date();

    type Outcome =
      | { kind: 'invalid' }
      | { kind: 'rotated' | 'grace' | 'reused'; session: typeof import('../../db/schema').sessions.$inferSelect; refreshToken?: string };

    const outcome = await withoutTenant(db, async (tx): Promise<Outcome> => {
      const current = await repo.findSessionByTokenHash(tx, hash);
      if (current) {
        if (current.revokedAt || current.expiresAt <= now) return { kind: 'invalid' };
        const next = randomToken();
        await repo.rotateSession(tx, current.id, {
          refreshTokenHash: sha256(next),
          previousTokenHash: hash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
          ip: client.ip,
          userAgent: client.userAgent,
        });
        return { kind: 'rotated', session: current, refreshToken: next };
      }

      const previous = await repo.findSessionByPreviousHash(tx, hash);
      if (!previous || previous.revokedAt || previous.expiresAt <= now) return { kind: 'invalid' };
      const sinceRotation = previous.rotatedAt ? now.getTime() - previous.rotatedAt.getTime() : Infinity;
      if (sinceRotation <= REFRESH_REUSE_GRACE_MS) return { kind: 'grace', session: previous };

      // a revogação precisa ser COMMITADA: por isso não lançamos o erro aqui dentro
      await revokeSessions(tx, { ids: [previous.id] }, 'REFRESH_TOKEN_REUSE');
      return { kind: 'reused', session: previous };
    });

    if (outcome.kind === 'invalid') throw unauthorized('Sua sessão expirou. Entre novamente.');
    if (outcome.kind === 'reused') {
      caches.sessions.delete(outcome.session.id);
      log.warn(
        { sessionId: outcome.session.id, userId: outcome.session.userId },
        'reuso de refresh token fora da tolerância: sessão revogada',
      );
      throw unauthorized('Por segurança, sua sessão foi encerrada. Entre novamente.');
    }

    const { session } = outcome;
    const membership = await this.membershipState(session.activeOrganizationId, session.userId);
    if (!membership?.isActive || !membership.organizationActive) {
      await withoutTenant(db, (tx) => revokeSessions(tx, { ids: [session.id] }, 'MEMBERSHIP_INACTIVE'));
      caches.sessions.delete(session.id);
      throw unauthorized('Seu acesso a esta oficina foi desativado.');
    }

    const ref = { userId: session.userId, organizationId: session.activeOrganizationId, sessionId: session.id };
    return { ...(await this.issueAccess(ref)), refreshToken: outcome.refreshToken ?? null };
  }

  // ------------------------------------------------------------------ logout

  async logout(refreshToken: string | undefined, sessionId: string | undefined): Promise<void> {
    const { db, caches } = this.deps;
    const ids = await withoutTenant(db, async (tx) => {
      const found = new Set<string>();
      if (sessionId) found.add(sessionId);
      if (refreshToken) {
        const session = await repo.findSessionByTokenHash(tx, sha256(refreshToken));
        if (session) found.add(session.id);
      }
      return revokeSessions(tx, { ids: [...found] }, 'LOGOUT');
    });
    ids.forEach((id) => caches.sessions.delete(id));
  }

  // --------------------------------------------------------- recuperar senha

  /** Resposta idêntica exista ou não o e-mail: não revela quem tem conta. */
  async forgotPassword(email: string, client: ClientInfo): Promise<void> {
    const { db, env, log } = this.deps;
    const user = await withoutTenant(db, (tx) => repo.findUserByEmail(tx, email));
    if (!user) {
      log.info('recuperação de senha pedida para e-mail sem conta');
      return;
    }

    const token = randomToken();
    await withoutTenant(db, async (tx) => {
      await repo.deleteUnusedPasswordResets(tx, user.id);
      await repo.insertPasswordReset(tx, {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        requestedIp: client.ip,
      });
    });

    await this.sendEmail({
      to: user.email,
      subject: 'Redefinição de senha: OficinaOS',
      text:
        `Olá, ${firstName(user.name)}.\n\n` +
        'Recebemos um pedido para redefinir a senha da sua conta no OficinaOS.\n' +
        'Para criar uma senha nova, abra o link abaixo (vale por 30 minutos):\n\n' +
        `${env.APP_URL}/redefinir-senha/${token}\n\n` +
        'Se não foi você, ignore este e-mail: sua senha continua a mesma.',
    });
  }

  /** Troca a senha, queima o link e encerra TODAS as sessões do usuário. */
  async resetPassword(token: string, password: string): Promise<void> {
    const { db, caches } = this.deps;
    const passwordHash = await hashPassword(password);
    const revoked = await withoutTenant(db, async (tx) => {
      const reset = await repo.findUsablePasswordReset(tx, sha256(token), new Date());
      if (!reset) return null;
      await repo.markPasswordResetUsed(tx, reset.id);
      await repo.updateUserPassword(tx, reset.userId, passwordHash);
      return revokeSessions(tx, { userId: reset.userId }, 'PASSWORD_RESET');
    });
    if (!revoked) {
      throw new AppError(
        400,
        ErrorCode.TOKEN_INVALID,
        'Link inválido',
        'Este link de redefinição é inválido ou expirou. Peça um novo.',
      );
    }
    revoked.forEach((id) => caches.sessions.delete(id));
  }

  // ------------------------------------------------------------ eu e sessões

  async me(ref: SessionRef): Promise<Me> {
    const { db } = this.deps;
    return withTenant(db, { organizationId: ref.organizationId, userId: ref.userId }, async (tx) => {
      const user = await repo.findUserById(tx, ref.userId);
      const organizations = await repo.listUserMemberships(tx, ref.userId);
      const current = organizations.find((o) => o.organizationId === ref.organizationId);
      if (!user || !current) throw unauthorized('Seu acesso a esta oficina não está mais ativo.');
      const subscription = await repo.getSubscriptionSummary(tx, ref.organizationId);

      return {
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: current.organizationId, name: current.organizationName, timezone: current.timezone },
        role: current.role,
        permissions: permissionsFor(current.role),
        organizations: organizations.map((o) => ({ id: o.organizationId, name: o.organizationName, role: o.role })),
        subscription: subscription
          ? {
              plan: subscription.plan,
              planName: subscription.planName,
              status: subscription.status,
              trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            }
          : null,
        sessionId: ref.sessionId,
      };
    });
  }

  async listSessions(ref: SessionRef): Promise<SessionInfo[]> {
    const rows = await withUser(this.deps.db, ref.userId, (tx) =>
      repo.listOpenSessions(tx, ref.userId, new Date()),
    );
    return rows.map((row) => ({
      id: row.id,
      current: row.id === ref.sessionId,
      userAgent: row.userAgent,
      ip: row.ip,
      organizationName: row.organizationName ?? '',
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt.toISOString(),
    }));
  }

  async revokeSession(ref: SessionRef, sessionId: string): Promise<void> {
    const { db, caches } = this.deps;
    const ids = await withoutTenant(db, (tx) =>
      revokeSessions(tx, { ids: [sessionId], userId: ref.userId }, 'USER_REVOKED'),
    );
    if (!ids.length) throw notFound('Sessão não encontrada.');
    caches.sessions.delete(sessionId);
  }

  async switchOrganization(ref: SessionRef, organizationId: string): Promise<AuthResult> {
    const { db } = this.deps;
    const organizations = await withUser(db, ref.userId, (tx) => repo.listUserMemberships(tx, ref.userId));
    if (!organizations.some((o) => o.organizationId === organizationId)) {
      throw notFound('Oficina não encontrada.');
    }
    await withoutTenant(db, (tx) => repo.setSessionOrganization(tx, ref.sessionId, organizationId));
    return { ...(await this.issueAccess({ ...ref, organizationId })), refreshToken: null };
  }

  // ---------------------------------------------------------------- convites

  async invitationPreview(rawToken: string): Promise<InvitationPreview> {
    const { db } = this.deps;
    const invitation = await this.findUsableInvitation(rawToken);
    const [organizationName, existing] = await Promise.all([
      withTenant(db, { organizationId: invitation.organizationId }, (tx) =>
        repo.findOrganizationName(tx, invitation.organizationId),
      ),
      withoutTenant(db, (tx) => repo.findUserByEmail(tx, invitation.email)),
    ]);
    return {
      organizationName: organizationName ?? '',
      email: invitation.email,
      role: invitation.role,
      existingAccount: Boolean(existing),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Conta nova: nome + senha forte. Conta existente: a senha atual dela (prova
   * que é a mesma pessoa, já que o link pode ter sido repassado).
   */
  async acceptInvitation(input: z.output<typeof acceptInvitationSchema>, client: ClientInfo): Promise<AuthResult> {
    const { db, caches } = this.deps;
    const invitation = await this.findUsableInvitation(input.token);
    const existing = await withoutTenant(db, (tx) => repo.findUserByEmail(tx, invitation.email));

    let newUser: { name: string; passwordHash: string } | null = null;
    if (existing) {
      if (!(await verifyPassword(existing.passwordHash, input.password))) {
        throw new AppError(
          401,
          ErrorCode.INVALID_CREDENTIALS,
          'Senha incorreta',
          `Já existe uma conta com ${invitation.email}. Use a senha dela para aceitar o convite.`,
        );
      }
    } else {
      const errors: FieldError[] = [];
      if (!input.name) errors.push({ path: 'body.name', message: 'Informe seu nome' });
      const strong = passwordSchema.safeParse(input.password);
      if (!strong.success) {
        errors.push({ path: 'body.password', message: strong.error.issues[0]?.message ?? 'Senha inválida' });
      }
      if (errors.length) throw validationFailed(errors);
      newUser = { name: input.name!, passwordHash: await hashPassword(input.password) };
    }

    const userId = existing?.id ?? uuidv7();
    const organizationId = invitation.organizationId;
    try {
      await withTenant(db, { organizationId, userId }, async (tx) => {
        const pending = await repo.lockPendingInvitation(tx, invitation.id, new Date());
        if (!pending) throw invalidInvitation();

        if (newUser) {
          await repo.insertUser(tx, {
            id: userId,
            name: newUser.name,
            email: invitation.email,
            passwordHash: newUser.passwordHash,
          });
        }

        const current = await repo.findMembershipRow(tx, organizationId, userId);
        if (current?.isActive) {
          throw new AppError(
            409,
            ErrorCode.ALREADY_MEMBER,
            'Já faz parte da equipe',
            'Esta conta já faz parte da equipe desta oficina.',
          );
        }
        const membership = current
          ? await repo.reactivateMembership(tx, current.id, pending.role)
          : await repo.insertMembership(tx, { organizationId, userId, role: pending.role });

        await repo.markInvitationAccepted(tx, pending.id, userId);
        await recordActivity(tx, {
          organizationId,
          actorUserId: userId,
          action: 'member.joined',
          entityType: 'membership',
          entityId: membership.id,
          metadata: { role: pending.role, invitationId: pending.id },
          ...client,
        });
      });
    } catch (err) {
      if (pgErrorCode(err) === UNIQUE_VIOLATION) {
        throw new AppError(
          409,
          ErrorCode.EMAIL_ALREADY_REGISTERED,
          'E-mail já cadastrado',
          'Uma conta com este e-mail acabou de ser criada. Abra o convite de novo.',
        );
      }
      throw err;
    }

    caches.memberships.delete(membershipKey(organizationId, userId));
    return this.startSession(userId, organizationId, client);
  }

  // ------------------------------------------------------------- internos

  /** Usado também pelo guard: estado do vínculo, com cache curto. */
  async membershipState(organizationId: string, userId: string): Promise<MembershipState | undefined> {
    const { db, caches } = this.deps;
    const key = membershipKey(organizationId, userId);
    const cached = caches.memberships.get(key);
    if (cached) return cached;
    const row = await withTenant(db, { organizationId, userId }, (tx) =>
      repo.findMembershipState(tx, organizationId, userId),
    );
    if (!row) return undefined;
    const state: MembershipState = {
      role: row.role,
      isActive: row.isActive,
      organizationActive: row.organizationStatus === 'ACTIVE',
    };
    caches.memberships.set(key, state);
    return state;
  }

  private async findUsableInvitation(rawToken: string) {
    const hash = sha256(rawToken);
    const invitation = await withInviteToken(this.deps.db, hash, (tx) => repo.findInvitationByTokenHash(tx, hash));
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw invalidInvitation();
    }
    return invitation;
  }

  private async startSession(userId: string, organizationId: string, client: ClientInfo): Promise<AuthResult> {
    const refreshToken = randomToken();
    const session = await withoutTenant(this.deps.db, (tx) =>
      repo.insertSession(tx, {
        userId,
        activeOrganizationId: organizationId,
        refreshTokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        ip: client.ip,
        userAgent: client.userAgent,
      }),
    );
    return { ...(await this.issueAccess({ userId, organizationId, sessionId: session.id })), refreshToken };
  }

  private async issueAccess(ref: SessionRef): Promise<AuthResponse> {
    const access = await this.deps.tokens.sign(ref);
    return { accessToken: access.token, expiresAt: access.expiresAt.toISOString(), me: await this.me(ref) };
  }

  private async sendEmail(message: Parameters<ServiceDeps['email']['send']>[0]): Promise<void> {
    try {
      await this.deps.email.send(message);
    } catch (err) {
      // falha de e-mail não pode vazar para a resposta (nem revelar se a conta existe)
      this.deps.log.error({ err, to: message.to }, 'falha ao enviar e-mail');
    }
  }
}
