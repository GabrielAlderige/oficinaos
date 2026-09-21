import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRACE_DAYS } from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import { addMember, bearer, createCustomer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

interface Visao {
  plan: string;
  planName: string;
  status: string;
  cycle: string;
  priceCents: number | null;
  emTeste: boolean;
  emCarencia: boolean;
  bloqueada: boolean;
  diasRestantes: number;
  provider: string;
  environment: string;
  checkoutUrl: string | null;
  usage: { users: number; maxUsers: number | null; workOrdersThisMonth: number; maxWorkOrdersPerMonth: number | null };
  plans: { code: string; current: boolean; priceMonthlyCents: number; priceYearlyCents: number | null }[];
  payments: { amountCents: number; status: string; paidAt: string | null }[];
}

/**
 * Assinatura do SaaS (V3, E20).
 *
 * O que precisa ficar provado: a oficina vê plano, uso e histórico; trocar de
 * plano muda limite e preço; cancelar deixa trabalhar até o fim do que foi
 * pago; o aviso do gateway é quem renova (e quem põe em atraso); e o bloqueio
 * por falta de pagamento trava a ESCRITA sem trancar a leitura nem a porta de
 * pagar.
 *
 * O gateway é o **simulador**: nenhuma assinatura é criada em lugar nenhum.
 */
describe('assinatura do SaaS', () => {
  let t: TestApp;
  let dono: TestSession;
  let gerente: TestSession;
  const { db } = testDb();

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const visao = async (s: TestSession = dono) => (await get('/api/v1/billing', s)).json() as Visao;

  /**
   * Mexe direto no banco no que só o tempo (ou o gateway) mudaria. Sempre com
   * `withTenant`: o RLS é FORÇADO, e sem contexto o UPDATE casa zero linhas
   * em silêncio (armadilha já paga na E9).
   */
  const forcar = (organizationId: string, patch: string) =>
    withTenant(db, { organizationId }, (tx) =>
      tx.execute(sql.raw(`update subscriptions set ${patch} where organization_id = '${organizationId}'`)),
    );

  /** A referência da assinatura no gateway, lida como a oficina. */
  const refDoGateway = async (organizationId: string) => {
    const { rows } = await withTenant(db, { organizationId }, (tx) =>
      tx.execute<{ provider_subscription_id: string }>(
        sql.raw(`select provider_subscription_id from subscriptions where organization_id = '${organizationId}'`),
      ),
    );
    return rows[0]!.provider_subscription_id;
  };

  const orgId = async (s: TestSession) =>
    ((await get('/api/v1/auth/me', s)).json() as { organization: { id: string } }).organization.id;

  /** O aviso do gateway sobre a cobrança de uma assinatura. */
  const avisar = (providerSubscriptionId: string, extra: Record<string, unknown> = {}) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/simulador',
      payload: {
        event: 'PAYMENT_RECEIVED',
        providerChargeId: `pay-${randomUUID()}`,
        providerSubscriptionId,
        amountCents: 19_900,
        ...extra,
      },
    });

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    gerente = await addMember(t.app, dono, 'MANAGER', 'Marta Gerente');
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ------------------------------- leitura -------------------------------

  it('a oficina nasce em teste, no plano Professional, e vê o uso do plano', async () => {
    const dados = await visao();
    expect(dados.plan).toBe('PROFESSIONAL');
    expect(dados.status).toBe('TRIALING');
    expect(dados.emTeste).toBe(true);
    expect(dados.bloqueada).toBe(false);
    expect(dados.diasRestantes).toBeGreaterThan(10);
    expect(dados.environment, 'o simulador não cobra ninguém').toBe('SIMULATOR');
    expect(dados.usage.users, 'dono + gerente').toBe(2);
    expect(dados.usage.maxUsers).toBe(8);
    expect(dados.plans.find((plano) => plano.current)?.code).toBe('PROFESSIONAL');
  });

  it('plano é coisa do dono: nem o gerente vê', async () => {
    expect((await get('/api/v1/billing', gerente)).statusCode).toBe(403);
    expect((await post('/api/v1/billing/cancel', {}, gerente)).statusCode).toBe(403);
  });

  // ------------------------------- assinar --------------------------------

  it('assinar guarda o preço congelado e a referência do gateway', async () => {
    const res = await post('/api/v1/billing/subscribe', {
      clientRequestId: randomUUID(),
      plan: 'PROFESSIONAL',
      cycle: 'MONTHLY',
    });
    expect(res.statusCode, res.body).toBe(200);
    const dados = res.json() as Visao;
    expect(dados.priceCents).toBe(19_900);
    expect(dados.cycle).toBe('MONTHLY');
    expect(dados.provider).toBe('simulador');
    expect(dados.status, 'continua em teste até a primeira cobrança cair').toBe('TRIALING');

    // assinar duas vezes não cria duas assinaturas no gateway
    const denovo = await post('/api/v1/billing/subscribe', {
      clientRequestId: randomUUID(),
      plan: 'PROFESSIONAL',
      cycle: 'MONTHLY',
    });
    expect(denovo.statusCode).toBe(409);
  });

  it('o ciclo anual não é oferecido enquanto não houver preço anual cadastrado', async () => {
    const res = await post('/api/v1/billing/change-plan', { plan: 'BUSINESS', cycle: 'YEARLY' });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { detail: string }).detail, 'nada de inventar desconto').toContain('preço anual');
  });

  it('trocar de plano muda limite e preço na hora', async () => {
    const res = await post('/api/v1/billing/change-plan', { plan: 'BUSINESS', cycle: 'MONTHLY' });
    expect(res.statusCode, res.body).toBe(200);
    const dados = res.json() as Visao;
    expect(dados.plan).toBe('BUSINESS');
    expect(dados.priceCents).toBe(39_900);
    expect(dados.usage.maxUsers, 'Business não tem teto de usuários').toBeNull();

    expect((await post('/api/v1/billing/change-plan', { plan: 'BUSINESS', cycle: 'MONTHLY' })).statusCode).toBe(409);
  });

  // ----------------------------- conciliação ------------------------------

  it('quem renova a assinatura é o aviso do gateway, e o reenvio não conta duas vezes', async () => {
    const organizationId = await orgId(dono);
    const ref = await refDoGateway(organizationId);
    const providerChargeId = `pay-${randomUUID()}`;

    const aviso = await avisar(ref, { providerChargeId, amountCents: 39_900 });
    expect(aviso.statusCode, aviso.body).toBe(200);
    expect((aviso.json() as { handled: boolean; reason: string }).reason).toBe('assinatura renovada');

    const dados = await visao();
    expect(dados.status).toBe('ACTIVE');
    expect(dados.emTeste, 'pagou: o teste acabou').toBe(false);
    expect(dados.payments[0]!.amountCents).toBe(39_900);
    expect(dados.payments[0]!.status).toBe('PAID');

    // o gateway reenvia o mesmo aviso até receber 200
    const repetido = await avisar(ref, { providerChargeId, amountCents: 39_900 });
    expect((repetido.json() as { reason: string }).reason).toBe('aviso repetido');
    expect((await visao()).payments, 'um pagamento, não dois').toHaveLength(1);
  });

  it('cobrança vencida põe a assinatura em atraso, com carência antes de cortar', async () => {
    const organizationId = await orgId(dono);
    const ref = await refDoGateway(organizationId);

    await avisar(ref, { event: 'PAYMENT_OVERDUE', providerChargeId: `pay-${randomUUID()}` });
    const atrasada = await visao();
    expect(atrasada.status).toBe('PAST_DUE');
    expect(atrasada.emCarencia, 'atrasou agora: a oficina continua trabalhando').toBe(true);
    expect(atrasada.bloqueada).toBe(false);
    expect(atrasada.diasRestantes).toBe(GRACE_DAYS);

    // e a oficina continua gravando durante a carência
    expect((await createCustomer(t.app, dono, { name: 'Cliente da Carência' })).id).toBeTruthy();
  });

  // ------------------------------- bloqueio -------------------------------

  it('passada a carência, a oficina lê tudo mas não grava — e ainda consegue pagar', async () => {
    const organizationId = await orgId(dono);
    await forcar(organizationId, `past_due_since = now() - interval '${GRACE_DAYS + 1} days'`);
    // o guard lê a assinatura de um cache de 30 s; mexer no banco por fora
    // (aqui, o tempo passando lá) só vale quando a entrada cai
    t.app.caches.subscriptions.delete(organizationId);

    const bloqueada = await visao();
    expect(bloqueada.bloqueada, 'a tela de plano continua abrindo').toBe(true);

    // ler: continua
    expect((await get('/api/v1/customers')).statusCode).toBe(200);
    expect((await get('/api/v1/work-orders')).statusCode).toBe(200);

    // gravar: barrado, com o caminho escrito
    const tentativa = await post('/api/v1/customers', { name: 'Cliente Novo' });
    expect(tentativa.statusCode).toBe(402);
    const erro = tentativa.json() as { code: string; detail: string };
    expect(erro.code).toBe('SUBSCRIPTION_BLOCKED');
    expect(erro.detail).toContain('Plano');

    // sair da conta e trocar de oficina continuam valendo
    expect((await get('/api/v1/auth/sessions')).statusCode).toBe(200);

    // e a porta de pagar nunca fecha
    const voltou = await post('/api/v1/billing/change-plan', { plan: 'PROFESSIONAL', cycle: 'MONTHLY' });
    expect(voltou.statusCode, voltou.body).toBe(200);

    // o aviso de pagamento destrava na hora (o cache da assinatura é invalidado)
    await avisar(await refDoGateway(organizationId), { providerChargeId: `pay-${randomUUID()}` });
    expect((await visao()).bloqueada).toBe(false);
    expect((await post('/api/v1/customers', { name: 'Cliente Depois do Pagamento' })).statusCode).toBe(201);
  });

  // ------------------------------- cancelar -------------------------------

  it('cancelar deixa trabalhar até o fim do que já foi pago, e dá para voltar atrás', async () => {
    const cancelou = await post('/api/v1/billing/cancel', { reason: 'Vou fechar a oficina' });
    expect(cancelou.statusCode, cancelou.body).toBe(200);
    const dados = cancelou.json() as Visao;
    expect(dados.status).toBe('CANCELED');
    expect(dados.bloqueada, 'o período pago vai até o fim').toBe(false);

    // e continua gravando enquanto o período pago não acaba
    expect((await post('/api/v1/customers', { name: 'Cliente do Período Pago' })).statusCode).toBe(201);

    expect((await post('/api/v1/billing/cancel', {})).statusCode).toBe(409);

    const voltou = await post('/api/v1/billing/resume', {});
    expect(voltou.statusCode, voltou.body).toBe(200);
    expect((voltou.json() as Visao).status).toBe('ACTIVE');
  });
});
