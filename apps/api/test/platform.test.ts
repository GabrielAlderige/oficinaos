import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { GRACE_DAYS, TRIAL_DAYS } from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import { bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

interface Oficina {
  id: string;
  name: string;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  activeUsers: number;
  emTeste: boolean;
  emCarencia: boolean;
  bloqueada: boolean;
  diasRestantes: number;
}
interface Visao {
  organizations: Oficina[];
  total: number;
  emTeste: number;
  assinantes: number;
  bloqueadas: number;
}

/**
 * A plataforma operando o SaaS (E41).
 *
 * O que precisa ficar provado: a oficina não enxerga esta área (nem o dono);
 * a plataforma enxerga TODAS as oficinas apesar do RLS por oficina; estender
 * o teste conta a partir de hoje e fica registrado; e quem já assinou não tem
 * teste para estender.
 */
describe('plataforma: operar o SaaS', () => {
  let t: TestApp;
  let oficina: TestSession;
  let outra: TestSession;
  let plataforma: TestSession;

  const get = (url: string, s: TestSession) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (url: string, payload: unknown, s: TestSession) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });

  beforeAll(async () => {
    t = await createTestApp();
    oficina = await signup(t.app);
    outra = await signup(t.app);
    plataforma = await signup(t.app);
    await testDb().db.execute(sql`update users set is_platform_admin = true where id = ${plataforma.userId}`);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('a oficina não entra na área da plataforma, nem o dono', async () => {
    expect((await get('/api/v1/platform/organizations', oficina)).statusCode).toBe(403);
    const tentativa = await post(
      `/api/v1/platform/organizations/${outra.orgId}/extend-trial`,
      { days: 90, reason: 'tentando' },
      oficina,
    );
    expect(tentativa.statusCode, 'nem contra outra oficina, nem contra a dela').toBe(403);
  });

  it('a plataforma enxerga TODAS as oficinas, apesar do RLS por oficina', async () => {
    const resposta = await get('/api/v1/platform/organizations', plataforma);
    expect(resposta.statusCode, resposta.body).toBe(200);
    const visao = resposta.json<Visao>();

    const ids = visao.organizations.map((o) => o.id);
    // as três nasceram em oficinas diferentes: se o RLS estivesse barrando, a
    // lista viria vazia — que é exatamente como este bug apareceria
    expect(ids).toContain(oficina.orgId);
    expect(ids).toContain(outra.orgId);
    expect(visao.total).toBeGreaterThanOrEqual(3);
    expect(visao.emTeste).toBeGreaterThanOrEqual(3);

    const minha = visao.organizations.find((o) => o.id === oficina.orgId)!;
    expect(minha.activeUsers, 'o dono conta como pessoa ativa').toBeGreaterThanOrEqual(1);
    expect(minha.emTeste).toBe(true);
    expect(minha.bloqueada).toBe(false);
    expect(minha.diasRestantes).toBeGreaterThan(TRIAL_DAYS - 2);
  });

  it('estender o teste conta a partir de HOJE, e não do fim que já venceu', async () => {
    // o caso real: o teste venceu e a oficina ainda está decidindo. Somar ao
    // fim vencido daria menos dias do que quem estendeu quis dar
    await withTenant(testDb().db, { organizationId: oficina.orgId }, (tx) =>
      tx.execute(
        sql`update subscriptions set trial_ends_at = now() - interval '30 days' where organization_id = ${oficina.orgId}`,
      ),
    );
    t.app.caches.subscriptions.delete(oficina.orgId);

    const bloqueada = (await get('/api/v1/platform/organizations', plataforma)).json<Visao>();
    expect(
      bloqueada.organizations.find((o) => o.id === oficina.orgId)!.bloqueada,
      'vencido há 30 dias: passou da carência',
    ).toBe(true);

    const estendida = await post(
      `/api/v1/platform/organizations/${oficina.orgId}/extend-trial`,
      { days: 60, reason: 'piloto com preço de fundador' },
      plataforma,
    );
    expect(estendida.statusCode, estendida.body).toBe(200);
    const depois = estendida.json<Oficina>();
    expect(depois.bloqueada, 'destravou').toBe(false);
    expect(depois.emTeste).toBe(true);
    expect(depois.diasRestantes, '60 dias a partir de hoje, não de 30 dias atrás').toBeGreaterThan(58);
  });

  it('a extensão fica registrada na trilha da oficina, com o motivo', async () => {
    // `withTenant` obrigatório: `activity_logs` tem RLS por oficina, e um
    // select solto daqui volta VAZIO — o teste falharia dizendo que não houve
    // registro quando houve
    const { rows } = await withTenant(testDb().db, { organizationId: oficina.orgId }, (tx) =>
      tx.execute<{ action: string; metadata: Record<string, unknown> }>(
        sql`select action, metadata from activity_logs
            where organization_id = ${oficina.orgId} and action = 'subscription.trial_extended'
            order by created_at desc limit 1`,
      ),
    );
    expect(rows.length, 'sem registro, o favor vira regra sem ninguém perceber').toBe(1);
    expect(rows[0]!.metadata.reason).toBe('piloto com preço de fundador');
    expect(rows[0]!.metadata.days).toBe(60);
  });

  it('quem já assinou não tem teste para estender', async () => {
    await withTenant(testDb().db, { organizationId: outra.orgId }, (tx) =>
      tx.execute(sql`update subscriptions set status = 'ACTIVE' where organization_id = ${outra.orgId}`),
    );
    t.app.caches.subscriptions.delete(outra.orgId);

    const recusado = await post(
      `/api/v1/platform/organizations/${outra.orgId}/extend-trial`,
      { days: 30, reason: 'não deveria passar' },
      plataforma,
    );
    expect(recusado.statusCode).toBe(409);
    expect(recusado.json<{ detail: string }>().detail).toContain('ACTIVE');
  });

  it('o teste recém-vencido aparece em carência, não bloqueado', async () => {
    // a armadilha do dia 15 (E41): quem venceu ontem ainda trabalha por 7 dias
    await withTenant(testDb().db, { organizationId: oficina.orgId }, (tx) =>
      tx.execute(
        sql`update subscriptions set trial_ends_at = now() - interval '1 day' where organization_id = ${oficina.orgId}`,
      ),
    );
    t.app.caches.subscriptions.delete(oficina.orgId);

    const visao = (await get('/api/v1/platform/organizations', plataforma)).json<Visao>();
    const minha = visao.organizations.find((o) => o.id === oficina.orgId)!;
    expect(minha.emTeste, 'o teste acabou').toBe(false);
    expect(minha.emCarencia, 'mas ainda trabalha').toBe(true);
    expect(minha.bloqueada).toBe(false);
    expect(minha.diasRestantes).toBe(GRACE_DAYS - 1);
  });
});
