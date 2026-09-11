import type { LightMyRequestResponse } from 'fastify';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, expect } from 'vitest';
import type { Me, Role, SignupInput } from '@oficinaos/shared';
import { buildApp, type App } from '../src/app';
import { readEnv, type Env } from '../src/config/env';
import { loadEnv } from '../src/config/load-env';
import { createDatabase, type DatabaseHandle } from '../src/db/client';
import { MemoryEmailProvider } from '../src/integrations/email/email';

loadEnv();

let handle: DatabaseHandle | undefined;

/** Banco de teste conectado como a role da APLICAÇÃO (sujeita ao RLS), como em produção. */
export function testDb(): DatabaseHandle {
  if (!handle) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error('Falta TEST_DATABASE_URL no .env');
    handle = createDatabase(url, { max: 4 });
    afterAll(async () => {
      await handle?.pool.end();
      handle = undefined;
    });
  }
  return handle;
}

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return readEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: 'segredo-de-teste-com-bem-mais-de-32-caracteres',
    EMAIL_DRIVER: 'memory',
    APP_URL: 'http://localhost:5173',
    ...overrides,
  });
}

export interface TestApp {
  app: App;
  email: MemoryEmailProvider;
}

export async function createTestApp(): Promise<TestApp> {
  const email = new MemoryEmailProvider();
  const app = await buildApp({ env: testEnv(), db: testDb().db, email });
  await app.ready();
  return { app, email };
}

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_PASSWORD = 'cavalo-correto-bateria-grampo';

let ipCounter = 0;
/**
 * Um IP diferente por chamada. Os limites por IP (cadastro, aceite de convite)
 * valem em produção sem atrapalhar a suíte, e sem nenhum desvio no código.
 */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export const uniqueEmail = (prefix = 'pessoa') => `${prefix}-${uuidv7()}@teste.local`;
export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
export const tokenFromUrl = (url: string) => url.slice(url.lastIndexOf('/') + 1);

export function refreshCookieOf(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === 'oos_rt')?.value || undefined;
}

export interface TestSession {
  accessToken: string;
  refreshToken: string;
  me: Me;
  email: string;
  password: string;
  orgId: string;
  userId: string;
  response: LightMyRequestResponse;
}

function toSession(res: LightMyRequestResponse, email: string, password: string): TestSession {
  const body = res.json();
  return {
    accessToken: body.accessToken,
    refreshToken: refreshCookieOf(res) ?? '',
    me: body.me,
    email,
    password,
    orgId: body.me.organization.id,
    userId: body.me.user.id,
    response: res,
  };
}

export function postPublic(app: App, url: string, payload?: unknown, cookies?: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url,
    headers: { origin: TEST_ORIGIN },
    remoteAddress: nextIp(),
    payload: payload as Record<string, unknown> | undefined,
    cookies,
  });
}

export async function signup(app: App, overrides: Partial<SignupInput> = {}): Promise<TestSession> {
  const body: SignupInput = {
    name: 'Dono Teste',
    email: uniqueEmail('dono'),
    password: TEST_PASSWORD,
    organizationName: 'Oficina Teste',
    whatsapp: '(11) 98765-4321',
    ...overrides,
  };
  const res = await postPublic(app, '/api/v1/auth/signup', body);
  expect(res.statusCode, res.body).toBe(201);
  return toSession(res, body.email, body.password);
}

export function login(app: App, email: string, password: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: TEST_ORIGIN },
    payload: { email, password, ...extra },
  });
}

export async function loginOk(app: App, email: string, password: string): Promise<TestSession> {
  const res = await login(app, email, password);
  expect(res.statusCode, res.body).toBe(200);
  return toSession(res, email, password);
}

export function refresh(app: App, refreshToken?: string) {
  return postPublic(app, '/api/v1/auth/refresh', undefined, refreshToken ? { oos_rt: refreshToken } : undefined);
}

export function me(app: App, accessToken: string) {
  return app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(accessToken) });
}

export async function invite(app: App, owner: TestSession, email: string, role: Role) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/members/invitations',
    headers: bearer(owner.accessToken),
    payload: { email, role },
  });
}

export function acceptInvite(app: App, payload: { token: string; name?: string; password: string }) {
  return postPublic(app, '/api/v1/auth/accept-invite', payload);
}

/** Convida uma pessoa nova com o papel dado e devolve a sessão dela já aceita. */
export async function addMember(app: App, owner: TestSession, role: Role, name = 'Pessoa da Equipe') {
  const email = uniqueEmail(role.toLowerCase());
  const created = await invite(app, owner, email, role);
  expect(created.statusCode, created.body).toBe(201);
  const res = await acceptInvite(app, { token: tokenFromUrl(created.json().inviteUrl), name, password: TEST_PASSWORD });
  expect(res.statusCode, res.body).toBe(200);
  const session = toSession(res, email, TEST_PASSWORD);
  const members = await app.inject({ method: 'GET', url: '/api/v1/members', headers: bearer(owner.accessToken) });
  const memberId = members.json().data.find((m: { userId: string }) => m.userId === session.userId).id as string;
  return { ...session, memberId };
}
