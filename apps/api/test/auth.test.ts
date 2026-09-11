import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activityLogs } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import {
  bearer,
  createTestApp,
  login,
  loginOk,
  me,
  postPublic,
  refresh,
  refreshCookieOf,
  signup,
  TEST_ORIGIN,
  testDb,
  uniqueEmail,
  type TestApp,
} from './helpers';

describe('autenticação', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  describe('cadastro', () => {
    it('cria oficina, dono e assinatura em teste, e já entra logado', async () => {
      const s = await signup(t.app, { organizationName: 'Auto Center Beta' });

      expect(s.me.role).toBe('OWNER');
      expect(s.me.permissions).toContain('billing:manage');
      expect(s.me.organization.name).toBe('Auto Center Beta');
      expect(s.me.organizations).toHaveLength(1);
      expect(s.me.subscription).toMatchObject({ plan: 'PROFESSIONAL', status: 'TRIALING' });
      const trialDays = (Date.parse(s.me.subscription!.trialEndsAt!) - Date.now()) / 86_400_000;
      expect(trialDays).toBeGreaterThan(13.9);
      expect(trialDays).toBeLessThanOrEqual(14);

      const cookie = s.response.cookies.find((c) => c.name === 'oos_rt');
      expect(cookie).toMatchObject({ httpOnly: true, path: '/api/v1/auth', sameSite: 'Strict' });
      expect(s.response.json()).not.toHaveProperty('refreshToken'); // refresh só no cookie

      const org = await t.app.inject({ method: 'GET', url: '/api/v1/organization', headers: bearer(s.accessToken) });
      expect(org.json().whatsapp).toBe('+5511987654321');
    });

    it('não aceita e-mail repetido, nem trocando maiúsculas', async () => {
      const s = await signup(t.app);
      const res = await postPublic(t.app, '/api/v1/auth/signup', {
        name: 'Outra Pessoa',
        email: s.email.toUpperCase(),
        password: 'outra-senha-bem-longa',
        organizationName: 'Outra Oficina',
        whatsapp: '11987654321',
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('aponta senha fraca e WhatsApp inválido campo a campo', async () => {
      const res = await postPublic(t.app, '/api/v1/auth/signup', {
        name: 'Fulano',
        email: uniqueEmail(),
        password: '12345678',
        organizationName: 'Oficina',
        whatsapp: '(20) 1234',
      });
      expect(res.statusCode).toBe(400);
      const paths = res.json().errors.map((e: { path: string }) => e.path);
      expect(paths).toEqual(expect.arrayContaining(['body.password', 'body.whatsapp']));
    });

    it('recusa cadastro vindo de fora do painel (sem Origin conhecido)', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        headers: { origin: 'https://site-malicioso.example' },
        payload: { name: 'X', email: uniqueEmail(), password: 'x', organizationName: 'x', whatsapp: 'x' },
      });
      // a validação do corpo roda antes; com corpo válido, a origem barra
      const valid = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/signup',
        headers: { origin: 'https://site-malicioso.example' },
        payload: {
          name: 'Fulano',
          email: uniqueEmail(),
          password: 'senha-longa-e-boa',
          organizationName: 'Oficina',
          whatsapp: '11987654321',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(valid.statusCode).toBe(403);
      expect(valid.json().code).toBe('ORIGIN_NOT_ALLOWED');
    });
  });

  describe('login', () => {
    it('entra com a senha certa e registra na auditoria', async () => {
      const s = await signup(t.app);
      const again = await loginOk(t.app, s.email, s.password);
      expect(again.me.user.id).toBe(s.userId);
      expect(again.me.sessionId).not.toBe(s.me.sessionId);

      const logs = await withTenant(testDb().db, { organizationId: s.orgId }, (tx) =>
        tx
          .select()
          .from(activityLogs)
          .where(and(eq(activityLogs.action, 'auth.login'), eq(activityLogs.entityId, s.userId))),
      );
      expect(logs).toHaveLength(1);
    });

    it('senha errada e e-mail inexistente dão exatamente a mesma resposta', async () => {
      const s = await signup(t.app);
      const wrong = await login(t.app, s.email, 'senha-errada-qualquer');
      const unknown = await login(t.app, uniqueEmail(), 'senha-errada-qualquer');
      expect(wrong.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      const strip = (b: Record<string, unknown>) => ({ ...b, requestId: undefined });
      expect(strip(wrong.json())).toEqual(strip(unknown.json()));
      expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    });

    it('bloqueia a 6ª tentativa no mesmo minuto', async () => {
      const email = uniqueEmail();
      for (let i = 0; i < 5; i++) expect((await login(t.app, email, 'errada-errada')).statusCode).toBe(401);
      const blocked = await login(t.app, email, 'errada-errada');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().code).toBe('RATE_LIMITED');
      expect(blocked.headers['retry-after']).toBeDefined();
    });
  });

  describe('token de acesso', () => {
    it('/me exige token válido', async () => {
      const s = await signup(t.app);
      expect((await t.app.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
      expect((await me(t.app, 'nao-e-um-jwt')).statusCode).toBe(401);
      const ok = await me(t.app, s.accessToken);
      expect(ok.statusCode).toBe(200);
      expect(ok.json().user.email).toBe(s.email);
    });

    it('rotas da oficina exigem login por padrão', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/api/v1/members' });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHORIZED');
    });
  });

  describe('renovação (refresh)', () => {
    it('troca o refresh token a cada uso e devolve um acesso novo', async () => {
      const s = await signup(t.app);
      const res = await refresh(t.app, s.refreshToken);
      expect(res.statusCode).toBe(200);
      const rotated = refreshCookieOf(res);
      expect(rotated).toBeDefined();
      expect(rotated).not.toBe(s.refreshToken);
      expect((await me(t.app, res.json().accessToken)).statusCode).toBe(200);
      expect((await refresh(t.app, rotated)).statusCode).toBe(200);
    });

    it('token anterior dentro da tolerância (duas abas): acesso novo, cookie intacto', async () => {
      const s = await signup(t.app);
      expect((await refresh(t.app, s.refreshToken)).statusCode).toBe(200);
      const second = await refresh(t.app, s.refreshToken);
      expect(second.statusCode).toBe(200);
      expect(refreshCookieOf(second)).toBeUndefined();
      expect((await me(t.app, second.json().accessToken)).statusCode).toBe(200);
    });

    it('token anterior fora da tolerância: alguém copiou o token, a sessão inteira cai', async () => {
      const s = await signup(t.app);
      const first = await refresh(t.app, s.refreshToken);
      const current = refreshCookieOf(first)!;

      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
      try {
        const reused = await refresh(t.app, s.refreshToken);
        expect(reused.statusCode).toBe(401);
        // até o token legítimo morre: a sessão foi revogada
        expect((await refresh(t.app, current)).statusCode).toBe(401);
        expect((await me(t.app, first.json().accessToken)).statusCode).toBe(401);
      } finally {
        vi.useRealTimers();
      }
    });

    it('sem cookie → 204 (visitante, não erro); cookie inválido → 401; de fora do painel → 403', async () => {
      const s = await signup(t.app);
      const anonymous = await refresh(t.app);
      expect(anonymous.statusCode).toBe(204);
      expect(anonymous.body).toBe('');
      expect((await refresh(t.app, 'token-que-nao-existe-em-lugar-nenhum')).statusCode).toBe(401);
      const foreign = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        headers: { origin: 'https://site-malicioso.example' },
        cookies: { oos_rt: s.refreshToken },
      });
      expect(foreign.statusCode).toBe(403);
    });
  });

  describe('logout e sessões', () => {
    it('logout encerra a sessão, apaga o cookie e invalida o acesso na hora', async () => {
      const s = await signup(t.app);
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { origin: TEST_ORIGIN, ...bearer(s.accessToken) },
        cookies: { oos_rt: s.refreshToken },
      });
      expect(res.statusCode).toBe(204);
      expect(res.cookies.find((c) => c.name === 'oos_rt')?.value).toBe('');
      expect((await refresh(t.app, s.refreshToken)).statusCode).toBe(401);
      expect((await me(t.app, s.accessToken)).statusCode).toBe(401);
    });

    it('lista as sessões e encerra uma delas (só as próprias)', async () => {
      const s = await signup(t.app);
      const other = await loginOk(t.app, s.email, s.password);
      const stranger = await signup(t.app);

      const list = await t.app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: bearer(s.accessToken) });
      const sessions = list.json().data;
      expect(sessions).toHaveLength(2);
      expect(sessions.find((x: { current: boolean }) => x.current).id).toBe(s.me.sessionId);

      const url = `/api/v1/auth/sessions/${other.me.sessionId}`;
      expect((await t.app.inject({ method: 'DELETE', url, headers: bearer(s.accessToken) })).statusCode).toBe(204);
      expect((await me(t.app, other.accessToken)).statusCode).toBe(401);
      expect((await t.app.inject({ method: 'DELETE', url, headers: bearer(s.accessToken) })).statusCode).toBe(404);

      const strangersUrl = `/api/v1/auth/sessions/${stranger.me.sessionId}`;
      expect((await t.app.inject({ method: 'DELETE', url: strangersUrl, headers: bearer(s.accessToken) })).statusCode).toBe(404);
      expect((await me(t.app, stranger.accessToken)).statusCode).toBe(200);
    });
  });

  describe('redefinição de senha', () => {
    it('link por e-mail, uso único, e derruba todas as sessões', async () => {
      const s = await signup(t.app);
      const asked = await postPublic(t.app, '/api/v1/auth/forgot-password', { email: s.email });
      const ghost = await postPublic(t.app, '/api/v1/auth/forgot-password', { email: uniqueEmail() });
      expect(asked.statusCode).toBe(202);
      expect(ghost.json()).toEqual(asked.json()); // não revela quem tem conta

      const mail = t.email.sent.findLast((m) => m.to === s.email);
      const token = mail?.text.match(/redefinir-senha\/([\w-]+)/)?.[1];
      expect(token).toBeDefined();

      const reset = await postPublic(t.app, '/api/v1/auth/reset-password', { token, password: 'nova-senha-bem-grande' });
      expect(reset.statusCode).toBe(204);
      expect((await me(t.app, s.accessToken)).statusCode).toBe(401);
      expect((await login(t.app, s.email, s.password)).statusCode).toBe(401);
      expect((await login(t.app, s.email, 'nova-senha-bem-grande')).statusCode).toBe(200);

      const reuse = await postPublic(t.app, '/api/v1/auth/reset-password', { token, password: 'outra-senha-grande' });
      expect(reuse.statusCode).toBe(400);
      expect(reuse.json().code).toBe('TOKEN_INVALID');
    });
  });
});
