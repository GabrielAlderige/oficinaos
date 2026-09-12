import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { ErrorCode, type Permission, type Role } from '@oficinaos/shared';
import type { Env } from '../config/env';
import type { Database } from '../db/client';
import type { EmailProvider } from '../integrations/email/email';
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
}

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Regra de acesso da rota, declarada em `config.auth`. Sem declaração, a rota
 * exige login: esquecer de marcar nunca deixa uma rota aberta.
 */
export type RouteAuth = 'public' | 'authenticated' | Permission;

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    auth?: RouteAuth;
  }
}

export interface SessionState {
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface MembershipState {
  role: Role;
  isActive: boolean;
  organizationActive: boolean;
}

export interface AuthCaches {
  sessions: TtlCache<SessionState>;
  memberships: TtlCache<MembershipState>;
}

export const membershipKey = (organizationId: string, userId: string) => `${organizationId}:${userId}`;

export function createAuthCaches(ttlMs: number): AuthCaches {
  return { sessions: new TtlCache(ttlMs), memberships: new TtlCache(ttlMs) };
}

/** Dependências comuns dos services. */
export interface ServiceDeps {
  db: Database;
  env: Env;
  email: EmailProvider;
  storage: StorageProvider;
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
