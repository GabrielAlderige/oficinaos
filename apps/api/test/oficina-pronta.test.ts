import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { FOUNDER_SLOTS, TRIAL_DAYS } from '@oficinaos/shared';
import { withPlatformAdmin, withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

const DIA = 86_400_000;

interface Assinatura {
  trialEndsAt: string | null;
  trialStartedAt: string | null;
}
interface Oficina extends Assinatura {
  id: string;
  setupDoneAt: string | null;
  founder: boolean;
  founderPriceUntil: string | null;
  workOrders: number;
  diasParada: number;
}

/**
 * A oferta Oficina Pronta (D92).
 *
 * O que precisa ficar provado: o teste de 30 dias NÃO começa no cadastro; ele
 * começa no primeiro orçamento enviado ou na implantação, o que vier antes, e
 * nunca estica o fim de quem já estava em teste sozinho; a fundadora paga
 * R$ 279 no Nitro mensal, e só nele; as vagas acabam no 10º; e o exemplo sai
 * inteiro, sem levar nada do que a oficina cadastrou.
 */
describe('oferta Oficina Pronta', () => {
  let t: TestApp;
  let plataforma: TestSession;

  const req = (method: 'GET' | 'POST' | 'DELETE' | 'PATCH', url: string, s: TestSession, payload?: unknown) =>
    t.app.inject({ method, url, headers: bearer(s.accessToken), payload: payload as never });

  const assinatura = async (s: TestSession): Promise<Assinatura> => {
    const {
      rows: [linha],
    } = await withTenant(testDb().db, { organizationId: s.orgId }, (tx) =>
      tx.execute<{ trial_ends_at: Date; trial_started_at: Date | null }>(
        sql`select trial_ends_at, trial_started_at from subscriptions where organization_id = ${s.orgId}`,
      ),
    );
    return {
      trialEndsAt: linha ? new Date(linha.trial_ends_at).toISOString() : null,
      trialStartedAt: linha?.trial_started_at ? new Date(linha.trial_started_at).toISOString() : null,
    };
  };
  const diasAte = (iso: string | null) => (Date.parse(iso!) - Date.now()) / DIA;

  /** Uma OS com um serviço, pronta para orçar. */
  async function osComServico(s: TestSession) {
    const servico = (await req('POST', '/api/v1/services', s, { name: `Revisão ${randomUUID().slice(0, 6)}`, priceCents: 20_000 })).json() as {
      id: string;
    };
    const cliente = await createCustomer(t.app, s);
    const carro = await createVehicle(t.app, s, cliente.id);
    return createWorkOrder(t.app, s, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [{ type: 'SERVICE', serviceId: servico.id }],
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
    plataforma = await signup(t.app);
    await testDb().db.execute(sql`update users set is_platform_admin = true where id = ${plataforma.userId}`);
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ------------------------------- o teste --------------------------------

  it('o primeiro orçamento enviado começa os 30 dias; o segundo não muda nada', async () => {
    const dono = await signup(t.app);
    const antes = await assinatura(dono);
    expect(antes.trialStartedAt, 'no cadastro o teste ainda não começou').toBeNull();
    expect(diasAte(antes.trialEndsAt)).toBeGreaterThan(44.9);

    const os = await osComServico(dono);
    expect((await req('POST', `/api/v1/work-orders/${os.id}/quotes`, dono, {})).statusCode).toBe(201);
    const depois = await assinatura(dono);
    expect(depois.trialStartedAt, 'o orçamento deu a partida').not.toBeNull();
    expect(diasAte(depois.trialEndsAt)).toBeGreaterThan(TRIAL_DAYS - 0.1);
    expect(diasAte(depois.trialEndsAt)).toBeLessThanOrEqual(TRIAL_DAYS);

    // e quem está logado vê na hora: o cache da assinatura foi limpo
    const me = (await req('GET', '/api/v1/auth/me', dono)).json() as { subscription: Assinatura };
    expect(me.subscription.trialStartedAt).toBe(depois.trialStartedAt);

    const outra = await osComServico(dono);
    expect((await req('POST', `/api/v1/work-orders/${outra.id}/quotes`, dono, {})).statusCode).toBe(201);
    expect(await assinatura(dono), 'o segundo orçamento não reinicia o relógio').toEqual(depois);
  });

  it('orçamento depois do início sozinho (15º dia) não dá 30 dias novos', async () => {
    const dono = await signup(t.app);
    // 20 dias depois do cadastro: o teste começou sozinho há 5 dias e acaba em 25
    const fim = new Date(Date.now() + 25 * DIA);
    await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(sql`update subscriptions set trial_ends_at = ${fim} where organization_id = ${dono.orgId}`),
    );
    t.app.caches.subscriptions.delete(dono.orgId);

    const os = await osComServico(dono);
    expect((await req('POST', `/api/v1/work-orders/${os.id}/quotes`, dono, {})).statusCode).toBe(201);
    const depois = await assinatura(dono);
    expect(Math.abs(Date.parse(depois.trialEndsAt!) - fim.getTime()), 'o fim continua o mesmo').toBeLessThan(1000);
    // o início gravado é o real (o 15º dia), e não o dia do orçamento
    expect(diasAte(depois.trialStartedAt)).toBeCloseTo(-5, 0);
  });

  it('quem assinou antes do primeiro orçamento não tem o teste encurtado (a fatura vence no fim gravado)', async () => {
    const dono = await signup(t.app);
    expect((await req('PATCH', '/api/v1/organization', dono, { document: '11.222.333/0001-81' })).statusCode).toBe(200);
    const assinou = await req('POST', '/api/v1/billing/subscribe', dono, {
      plan: 'NITRO',
      cycle: 'MONTHLY',
      clientRequestId: randomUUID(),
    });
    expect(assinou.statusCode, assinou.body).toBe(200);
    const antes = await assinatura(dono);

    const os = await osComServico(dono);
    expect((await req('POST', `/api/v1/work-orders/${os.id}/quotes`, dono, {})).statusCode).toBe(201);
    const depois = await assinatura(dono);
    // encurtar para 30 dias travava a oficina dias antes de a 1ª fatura vencer
    expect(depois.trialEndsAt).toBe(antes.trialEndsAt);
    expect(diasAte(depois.trialEndsAt)).toBeGreaterThan(44.9);
  });

  // ------------------------------ plataforma -------------------------------

  it('a implantação marcada pela plataforma começa o teste; a oficina não marca sozinha', async () => {
    const dono = await signup(t.app);
    expect((await req('POST', `/api/v1/platform/organizations/${dono.orgId}/setup-done`, dono, {})).statusCode).toBe(403);

    const resposta = await req('POST', `/api/v1/platform/organizations/${dono.orgId}/setup-done`, plataforma, {
      note: 'visita de terça',
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    const oficina = resposta.json() as Oficina;
    expect(oficina.setupDoneAt).not.toBeNull();
    expect(oficina.trialStartedAt).not.toBeNull();
    expect(diasAte(oficina.trialEndsAt)).toBeGreaterThan(TRIAL_DAYS - 0.1);

    // marcar de novo não muda a data da primeira vez
    const denovo = (await req('POST', `/api/v1/platform/organizations/${dono.orgId}/setup-done`, plataforma, {})).json() as Oficina;
    expect(denovo.setupDoneAt).toBe(oficina.setupDoneAt);
    expect(denovo.trialEndsAt).toBe(oficina.trialEndsAt);

    const trilha = await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from activity_logs where organization_id = ${dono.orgId} and action = 'subscription.setup_done'`,
      ),
    );
    expect(trilha.rows.length, 'fica na trilha da oficina, as duas vezes').toBe(2);
  });

  it('a plataforma vê quantas OS cada oficina abriu e há quantos dias está parada', async () => {
    const dono = await signup(t.app);
    await osComServico(dono);
    const visao = (await req('GET', '/api/v1/platform/organizations', plataforma)).json() as {
      organizations: Oficina[];
    };
    const minha = visao.organizations.find((o) => o.id === dono.orgId)!;
    expect(minha.workOrders, 'apesar do RLS por oficina').toBe(1);
    expect(minha.diasParada).toBe(0);
  });

  it('fundadora: 90 dias de teste e o Nitro mensal a R$ 279, só no Nitro mensal', async () => {
    const dono = await signup(t.app);
    const resposta = await req('POST', `/api/v1/platform/organizations/${dono.orgId}/founder`, plataforma, {
      reason: 'visita, topou dar depoimento',
    });
    expect(resposta.statusCode, resposta.body).toBe(200);
    const oficina = resposta.json() as Oficina;
    expect(oficina.founder).toBe(true);
    expect(diasAte(oficina.trialEndsAt)).toBeGreaterThan(89.9);
    // 12 meses de preço DEPOIS dos 90 dias de teste
    expect(diasAte(oficina.founderPriceUntil)).toBeGreaterThan(90 + 360);

    expect((await req('POST', `/api/v1/platform/organizations/${dono.orgId}/founder`, plataforma, { reason: 'de novo' })).statusCode).toBe(409);

    // o primeiro orçamento da fundadora NÃO encurta os 90 dias para 30
    const os = await osComServico(dono);
    expect((await req('POST', `/api/v1/work-orders/${os.id}/quotes`, dono, {})).statusCode).toBe(201);
    expect(diasAte((await assinatura(dono)).trialEndsAt), 'continua com os 90 dias').toBeGreaterThan(89.9);

    await req('PATCH', '/api/v1/organization', dono, { document: '11.222.333/0001-81' });
    const plano = (await req('GET', '/api/v1/billing', dono)).json() as { founderPriceCents: number | null };
    expect(plano.founderPriceCents).toBe(27_900);

    const nitro = await req('POST', '/api/v1/billing/subscribe', dono, {
      clientRequestId: randomUUID(),
      plan: 'NITRO',
      cycle: 'MONTHLY',
    });
    expect(nitro.statusCode, nitro.body).toBe(200);
    expect((nitro.json() as { priceCents: number }).priceCents, 'o preço travado, e não os R$ 499 da tabela').toBe(27_900);

    // trocar para o anual não leva o desconto junto
    const anual = await req('POST', '/api/v1/billing/change-plan', dono, { plan: 'NITRO', cycle: 'YEARLY' });
    expect(anual.statusCode, anual.body).toBe(200);
    expect((anual.json() as { priceCents: number }).priceCents).toBeGreaterThan(27_900 * 10);
  });

  it(`as vagas de fundadora acabam na ${FOUNDER_SLOTS}ª`, async () => {
    const {
      rows: [ocupadas],
    } = await withPlatformAdmin(testDb().db, (tx) =>
      tx.execute<{ total: number }>(sql`select count(*)::int as total from subscriptions where founder_price_cents is not null`),
    );
    const faltam = FOUNDER_SLOTS - Number(ocupadas?.total ?? 0);
    for (let i = 0; i < faltam; i++) {
      const dono = await signup(t.app);
      const ok = await req('POST', `/api/v1/platform/organizations/${dono.orgId}/founder`, plataforma, { reason: `vaga ${i}` });
      expect(ok.statusCode, ok.body).toBe(200);
    }
    const sobrou = await signup(t.app);
    const recusa = await req('POST', `/api/v1/platform/organizations/${sobrou.orgId}/founder`, plataforma, { reason: 'a 11ª' });
    expect(recusa.statusCode).toBe(409);
    expect((recusa.json() as { title: string }).title).toBe('Acabaram as vagas');
  });

  // --------------------------- dados de exemplo ----------------------------

  it('o exemplo entra, não entra duas vezes e sai inteiro, sem levar o que é da oficina', async () => {
    const dono = await signup(t.app);
    const minha = await createCustomer(t.app, dono, { name: 'Cliente de Verdade' });

    const carregado = await req('POST', '/api/v1/sample-data', dono);
    expect(carregado.statusCode, carregado.body).toBe(200);
    expect(carregado.json()).toMatchObject({ loaded: true, customers: 3, services: 4 });
    expect((await req('POST', '/api/v1/sample-data', dono)).statusCode, 'duas vezes não').toBe(409);

    const lista = (await req('GET', '/api/v1/customers?pageSize=50', dono)).json() as { meta: { total: number } };
    expect(lista.meta.total).toBe(4);

    // um cliente do exemplo ganhou OS de verdade: ele fica, para a OS não perder o dono
    const clientes = (await req('GET', '/api/v1/customers?q=exemplo&pageSize=50', dono)).json() as {
      data: { id: string; name: string }[];
    };
    const usado = clientes.data.find((c) => c.name.startsWith('Maria'))!;
    const veiculos = ((await req('GET', `/api/v1/customers/${usado.id}/vehicles`, dono)).json() as { data: { id: string }[] }).data;
    await createWorkOrder(t.app, dono, { customerId: usado.id, vehicleId: veiculos[0]!.id, items: [] });

    const apagado = await req('DELETE', '/api/v1/sample-data', dono);
    expect(apagado.statusCode, apagado.body).toBe(200);
    expect(apagado.json()).toMatchObject({ loaded: false, kept: 1 });

    const depois = (await req('GET', '/api/v1/customers?pageSize=50', dono)).json() as { data: { id: string }[] };
    expect(depois.data.map((c) => c.id).sort()).toEqual([minha.id, usado.id].sort());
    const servicos = (await req('GET', '/api/v1/services?q=exemplo', dono)).json() as { meta: { total: number } };
    expect(servicos.meta.total, 'os serviços de exemplo saíram').toBe(0);

    // e o exemplo não começa o teste: cliente e serviço de mentira não são uso
    expect((await assinatura(dono)).trialStartedAt).toBeNull();
  });

  it('o mecânico não carrega nem apaga o exemplo', async () => {
    const dono = await signup(t.app);
    const mecanico = await addMember(t.app, dono, 'MECHANIC');
    expect((await req('POST', '/api/v1/sample-data', mecanico)).statusCode).toBe(403);
    expect((await req('DELETE', '/api/v1/sample-data', mecanico)).statusCode).toBe(403);
  });
});
