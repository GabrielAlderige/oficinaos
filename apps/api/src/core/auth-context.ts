import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { ErrorCode, type Permission, type PlanFeature, type Role, type SubscriptionStatus } from '@oficinaos/shared';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import type { EmailProvider } from '../integrations/email/email';
import type { NfseProvider } from '../integrations/fiscal/nfse';
import type { PaymentGateway } from '../integrations/payments';
import type { StorageProvider } from '../integrations/storage/storage';
import type { AccessTokens } from '../modules/auth/tokens';
import { TtlCache } from './cache';
import { AppError } from './errors';

/** Quem está fazendo a requisição. Vem só do token validado + banco, nunca do body. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  sessionId: string;
  role: Role;
  /** administrador da PLATAFORMA (E31): mexe no catálogo que todas as oficinas leem */
  isPlatformAdmin: boolean;
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Regra de acesso da rota, declarada em `config.auth`. Sem declaração, a rota
 * exige login: esquecer de marcar nunca deixa uma rota aberta.
 */
export type RouteAuth = 'public' | 'authenticated' | 'platform-admin' | Permission;

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    auth?: RouteAuth;
    /**
     * A rota continua funcionando com a assinatura vencida (E20). Vale para
     * sair da conta e para pagar: bloquear quem quer acertar a conta seria
     * bloquear a própria cobrança.
     */
    allowBlocked?: boolean;
    /**
     * A rota só existe para quem tem esta funcionalidade no plano (E40).
     * Roda DEPOIS da permissão: quem não pode por papel recebe 403 de papel,
     * e não um convite para assinar um plano que não resolveria nada.
     */
    feature?: PlanFeature;
  }
}

export interface SessionState {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  /** marca da CONTA, não da oficina: administrador da plataforma (E31) */
  isPlatformAdmin: boolean;
}

export interface MembershipState {
  role: Role;
  isActive: boolean;
  organizationActive: boolean;
}

/** O que o guard precisa saber da assinatura para decidir se ainda grava (E20). */
export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  /** o plano em vigor e o que ele libera (E40): o guard barra por isto */
  planCode: string;
  planName: string;
  features: string[];
}

export interface AuthCaches {
  sessions: TtlCache<SessionState>;
  memberships: TtlCache<MembershipState>;
  subscriptions: TtlCache<SubscriptionState>;
}

export const membershipKey = (organizationId: string, userId: string) => `${organizationId}:${userId}`;

export function createAuthCaches(ttlMs: number): AuthCaches {
  return { sessions: new TtlCache(ttlMs), memberships: new TtlCache(ttlMs), subscriptions: new TtlCache(ttlMs) };
}

/** Dependências comuns dos services. */
export interface ServiceDeps {
  db: Database;
  env: Env;
  email: EmailProvider;
  storage: StorageProvider;
  nfse: NfseProvider;
  /**
   * Monta o emissor de verdade de UMA oficina (Focus NFe, com o token dela).
   * Os testes trocam por um que não sai para a internet.
   */
  emissorDaOficina: (opcoes: { token: string; environment: 'HOMOLOGATION' | 'PRODUCTION' }) => NfseProvider;
  /** o da plataforma: assinatura do SaaS e leitura dos avisos */
  gateway: PaymentGateway;
  /** o da cobrança da oficina para o cliente; `null` é desligado */
  chargesGateway: PaymentGateway | null;
  tokens: AccessTokens;
  caches: AuthCaches;
  log: FastifyBaseLogger;
}

export function getAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Não autenticado');
  return request.auth;
}

export function clientInfo(request: FastifyRequest): ClientInfo {
  return {
    ip: request.ip || null,
    userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
  };
}
