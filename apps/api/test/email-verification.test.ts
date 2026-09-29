import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, signup, type TestApp, type TestSession } from './helpers';

/**
 * Confirmação de e-mail no cadastro (E29).
 *
 * O e-mail confirmado é o que garante que a recuperação de senha chega em
 * algum lugar. Por isso o link sai sozinho no cadastro — mas não trava nada:
 * quem acabou de se cadastrar entra e trabalha, com um aviso no painel.
 */
describe('confirmação de e-mail', () => {
  let t: TestApp;

  const post = (url: string, payload: unknown = {}) =>
    t.app.inject({ method: 'POST', url, payload: payload as never });
  const me = (s: TestSession) =>
    t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(s.accessToken) });

  /** O token do último e-mail de confirmação enviado para aquele endereço. */
  const tokenDe = (email: string) =>
    t.email.sent.findLast((m) => m.to === email && m.text.includes('confirmar-email'))
      ?.text.match(/confirmar-email\/([\w-]+)/)?.[1];

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('o cadastro manda o link sozinho, e a conta já funciona sem confirmar', async () => {
    const dono = await signup(t.app);
    expect(tokenDe(dono.email), 'o e-mail saiu no cadastro').toBeDefined();

    const antes = await me(dono);
    expect(antes.statusCode, 'confirmar não é condição para usar o sistema').toBe(200);
    expect(antes.json().user.emailVerifiedAt, 'mas o painel sabe que falta').toBeNull();
  });

  it('o link confirma, vale uma vez só, e o painel passa a saber', async () => {
    const dono = await signup(t.app);
    const token = tokenDe(dono.email);

    const confirmado = await post('/api/v1/auth/verify-email', { token });
    expect(confirmado.statusCode, confirmado.body).toBe(204);
    expect((await me(dono)).json().user.emailVerifiedAt).not.toBeNull();

    const repetido = await post('/api/v1/auth/verify-email', { token });
    expect(repetido.statusCode, 'o mesmo link não serve duas vezes').toBe(400);
    expect(repetido.json().code).toBe('TOKEN_INVALID');
  });

  it('quem entra por convite também recebe o link', async () => {
    const dono = await signup(t.app);
    const convite = await t.app.inject({
      method: 'POST',
      url: '/api/v1/members/invitations',
      headers: bearer(dono.accessToken),
      payload: { email: 'mecanico.novo@teste.local', role: 'MECHANIC' },
    });
    const chave = (convite.json() as { inviteUrl: string }).inviteUrl.split('/').pop();

    const aceito = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/accept-invite',
      headers: { origin: 'http://localhost:5173' },
      payload: { token: chave, name: 'Ze Mecanico', password: 'senha-bem-grande-aqui' },
    });
    expect(aceito.statusCode, aceito.body).toBe(200);
    // o mecânico recupera a senha sozinho, sem depender do dono da oficina
    expect(tokenDe('mecanico.novo@teste.local'), 'o link saiu para quem foi convidado').toBeDefined();
  });

  it('link inventado não confirma ninguém', async () => {
    const res = await post('/api/v1/auth/verify-email', { token: 'a'.repeat(43) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('TOKEN_INVALID');
  });

  it('reenviar manda um link novo — e aposenta o anterior', async () => {
    const dono = await signup(t.app);
    const primeiro = tokenDe(dono.email);

    const reenvio = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: bearer(dono.accessToken),
    });
    expect(reenvio.statusCode).toBe(202);

    const segundo = tokenDe(dono.email);
    expect(segundo).not.toBe(primeiro);

    const velho = await post('/api/v1/auth/verify-email', { token: primeiro });
    expect(velho.statusCode, 'o link antigo foi apagado ao pedir outro').toBe(400);
    expect((await post('/api/v1/auth/verify-email', { token: segundo })).statusCode).toBe(204);
  });

  it('o /me é o que o painel lê para decidir se avisa', async () => {
    const dono = await signup(t.app);
    // é ESTE campo que o aviso do painel consulta: antes tem data nenhuma,
    // depois de confirmar tem a data, e o aviso some por causa dela
    expect((await me(dono)).json().user.emailVerifiedAt).toBeNull();
    await post('/api/v1/auth/verify-email', { token: tokenDe(dono.email) });
    const depois = (await me(dono)).json().user.emailVerifiedAt as string;
    expect(depois, 'uma data ISO de verdade').toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('quem já confirmou não recebe link novo ao reenviar', async () => {
    const dono = await signup(t.app);
    await post('/api/v1/auth/verify-email', { token: tokenDe(dono.email) });
    const quantosAntes = t.email.sent.filter((m) => m.to === dono.email).length;

    const reenvio = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/resend-verification',
      headers: bearer(dono.accessToken),
    });
    expect(reenvio.statusCode, 'a resposta é a mesma, para não virar sonda de contas').toBe(202);
    expect(t.email.sent.filter((m) => m.to === dono.email).length, 'mas nenhum e-mail saiu').toBe(quantosAntes);
  });
});
