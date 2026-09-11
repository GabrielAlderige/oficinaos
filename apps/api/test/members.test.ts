import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptInvite,
  addMember,
  bearer,
  createTestApp,
  invite,
  loginOk,
  me,
  signup,
  TEST_PASSWORD,
  tokenFromUrl,
  uniqueEmail,
  type TestApp,
} from './helpers';

describe('equipe e convites', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string, token: string) => t.app.inject({ method: 'GET', url, headers: bearer(token) });
  const patchMember = (id: string, token: string, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1/members/${id}`, headers: bearer(token), payload });

  it('dono convida, pessoa nova aceita e entra com o papel do convite', async () => {
    const owner = await signup(t.app, { organizationName: 'Auto Center Alfa' });
    const email = uniqueEmail('mecanico');

    const created = await invite(t.app, owner, email, 'MECHANIC');
    expect(created.statusCode).toBe(201);
    const { inviteUrl } = created.json();
    expect(inviteUrl).toMatch(/^http:\/\/localhost:5173\/convite\/[\w-]{43}$/);
    expect(t.email.sent.some((m) => m.to === email && m.text.includes(inviteUrl))).toBe(true);

    const token = tokenFromUrl(inviteUrl);
    const preview = await t.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` });
    expect(preview.json()).toMatchObject({
      organizationName: 'Auto Center Alfa',
      email,
      role: 'MECHANIC',
      existingAccount: false,
    });

    const accepted = await acceptInvite(t.app, { token, name: 'Mecânico Novo', password: TEST_PASSWORD });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().me).toMatchObject({ role: 'MECHANIC', organization: { name: 'Auto Center Alfa' } });

    const reused = await acceptInvite(t.app, { token, name: 'Outro', password: TEST_PASSWORD });
    expect(reused.statusCode).toBe(400);
    expect(reused.json().code).toBe('TOKEN_INVALID');

    const members = (await get('/api/v1/members', owner.accessToken)).json().data;
    expect(members.map((m: { name: string }) => m.name)).toEqual(['Dono Teste', 'Mecânico Novo']);
    expect((await get('/api/v1/members/invitations', owner.accessToken)).json().data).toEqual([]);
  });

  it('conta nova precisa de nome e senha forte', async () => {
    const owner = await signup(t.app);
    const created = await invite(t.app, owner, uniqueEmail(), 'ATTENDANT');
    const res = await acceptInvite(t.app, { token: tokenFromUrl(created.json().inviteUrl), password: '12345678' });
    expect(res.statusCode).toBe(400);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['body.name', 'body.password']));
  });

  it('mecânico vê a equipe e a oficina, mas não convida nem altera a oficina', async () => {
    const owner = await signup(t.app);
    const mechanic = await addMember(t.app, owner, 'MECHANIC');

    expect((await get('/api/v1/members', mechanic.accessToken)).statusCode).toBe(200);
    expect((await get('/api/v1/organization', mechanic.accessToken)).statusCode).toBe(200);

    const inviting = await invite(t.app, mechanic, uniqueEmail(), 'MECHANIC');
    expect(inviting.statusCode).toBe(403);
    expect(inviting.json().code).toBe('FORBIDDEN');
    expect((await get('/api/v1/members/invitations', mechanic.accessToken)).statusCode).toBe(403);
    const editing = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(mechanic.accessToken),
      payload: { name: 'Tomada' },
    });
    expect(editing.statusCode).toBe(403);
  });

  it('administrador gerencia a equipe, mas não cria nem mexe em dono', async () => {
    const owner = await signup(t.app);
    const admin = await addMember(t.app, owner, 'ADMIN');
    const ownerMemberId = (await get('/api/v1/members', owner.accessToken))
      .json()
      .data.find((m: { role: string }) => m.role === 'OWNER').id;

    expect((await invite(t.app, admin, uniqueEmail(), 'MANAGER')).statusCode).toBe(201);
    expect((await invite(t.app, admin, uniqueEmail(), 'OWNER')).statusCode).toBe(403);
    expect((await patchMember(ownerMemberId, admin.accessToken, { role: 'MECHANIC' })).statusCode).toBe(403);
  });

  it('ninguém altera o próprio acesso', async () => {
    const owner = await signup(t.app);
    const ownId = (await get('/api/v1/members', owner.accessToken)).json().data[0].id;
    const res = await patchMember(ownId, owner.accessToken, { role: 'MECHANIC' });
    expect(res.statusCode).toBe(403);
  });

  it('mudar o papel vale na hora, sem novo login', async () => {
    const owner = await signup(t.app);
    const attendant = await addMember(t.app, owner, 'ATTENDANT');
    expect((await me(t.app, attendant.accessToken)).json().role).toBe('ATTENDANT');

    const res = await patchMember(attendant.memberId, owner.accessToken, { role: 'MANAGER' });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('MANAGER');
    const after = (await me(t.app, attendant.accessToken)).json();
    expect(after.role).toBe('MANAGER');
    expect(after.permissions).toContain('work_orders:discount_unlimited');
  });

  it('desativar derruba o acesso na hora; reativar exige novo login', async () => {
    const owner = await signup(t.app);
    const mechanic = await addMember(t.app, owner, 'MECHANIC');

    expect((await patchMember(mechanic.memberId, owner.accessToken, { isActive: false })).statusCode).toBe(200);
    expect((await me(t.app, mechanic.accessToken)).statusCode).toBe(401);
    const blocked = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: { email: mechanic.email, password: mechanic.password },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('NO_ACTIVE_MEMBERSHIP');

    expect((await patchMember(mechanic.memberId, owner.accessToken, { isActive: true })).statusCode).toBe(200);
    expect((await me(t.app, mechanic.accessToken)).statusCode).toBe(401); // a sessão antiga continua encerrada
    expect((await loginOk(t.app, mechanic.email, mechanic.password)).me.role).toBe('MECHANIC');
  });

  it('remover da equipe tira o acesso e some da lista', async () => {
    const owner = await signup(t.app);
    const finance = await addMember(t.app, owner, 'FINANCE');
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/members/${finance.memberId}`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(204);
    expect((await me(t.app, finance.accessToken)).statusCode).toBe(401);
    const ids = (await get('/api/v1/members', owner.accessToken)).json().data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain(finance.memberId);
  });

  it('outra oficina não enxerga nem altera esta equipe (404, não 403)', async () => {
    const ownerA = await signup(t.app);
    const memberA = await addMember(t.app, ownerA, 'MECHANIC');
    const ownerB = await signup(t.app);

    const pending = await invite(t.app, ownerA, uniqueEmail(), 'MECHANIC');
    const res = await patchMember(memberA.memberId, ownerB.accessToken, { isActive: false });
    expect(res.statusCode).toBe(404);
    const revoke = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/members/invitations/${pending.json().id}`,
      headers: bearer(ownerB.accessToken),
    });
    expect(revoke.statusCode).toBe(404);
    expect((await me(t.app, memberA.accessToken)).statusCode).toBe(200);

    const bList = (await get('/api/v1/members', ownerB.accessToken)).json().data;
    expect(bList).toHaveLength(1);
  });

  it('quem já tem conta aceita com a própria senha e passa a ter duas oficinas', async () => {
    const ownerA = await signup(t.app, { organizationName: 'Oficina A' });
    const ownerB = await signup(t.app, { organizationName: 'Oficina B' });

    const created = await invite(t.app, ownerA, ownerB.email, 'MANAGER');
    const token = tokenFromUrl(created.json().inviteUrl);
    const preview = (await t.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${token}` })).json();
    expect(preview.existingAccount).toBe(true);

    expect((await acceptInvite(t.app, { token, password: 'senha-errada-de-todo' })).statusCode).toBe(401);
    const accepted = await acceptInvite(t.app, { token, password: ownerB.password });
    expect(accepted.statusCode).toBe(200);
    const inA = accepted.json();
    expect(inA.me).toMatchObject({ role: 'MANAGER', organization: { name: 'Oficina A' } });
    expect(inA.me.organizations.map((o: { name: string }) => o.name).sort()).toEqual(['Oficina A', 'Oficina B']);

    const switched = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-organization',
      headers: bearer(inA.accessToken),
      payload: { organizationId: ownerB.orgId },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().me).toMatchObject({ role: 'OWNER', organization: { name: 'Oficina B' } });

    const foreign = await signup(t.app);
    const denied = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-organization',
      headers: bearer(inA.accessToken),
      payload: { organizationId: foreign.orgId },
    });
    expect(denied.statusCode).toBe(404);
  });

  it('convidar quem já é da equipe → 409', async () => {
    const owner = await signup(t.app);
    const member = await addMember(t.app, owner, 'ATTENDANT');
    const res = await invite(t.app, owner, member.email, 'MECHANIC');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ALREADY_MEMBER');
  });

  it('o limite de usuários do plano conta os convites pendentes', async () => {
    const owner = await signup(t.app); // plano de teste: Professional, 8 usuários
    for (let i = 0; i < 7; i++) expect((await invite(t.app, owner, uniqueEmail(), 'MECHANIC')).statusCode).toBe(201);
    const over = await invite(t.app, owner, uniqueEmail(), 'MECHANIC');
    expect(over.statusCode).toBe(403);
    expect(over.json().code).toBe('PLAN_LIMIT_REACHED');
  });

  it('revogar o convite invalida o link', async () => {
    const owner = await signup(t.app);
    const created = (await invite(t.app, owner, uniqueEmail(), 'MECHANIC')).json();
    const revoke = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/members/invitations/${created.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(revoke.statusCode).toBe(204);
    const preview = await t.app.inject({ method: 'GET', url: `/api/v1/auth/invitations/${tokenFromUrl(created.inviteUrl)}` });
    expect(preview.statusCode).toBe(400);
  });
});
