import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRACE_DAYS } from '@oficinaos/shared';
import { withTenant } from '../src/db/tenant';
import { SimuladorPaymentGateway } from '../src/integrations/payments/gateway';
import { bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

/** O simulador, guardando quais assinaturas a API mandou cancelar. */
class GatewayQueAnota extends SimuladorPaymentGateway {
  cancelados: string[] = [];
  private n = 0;
  override async cancelarAssinatura(providerSubscriptionId: string) {
    this.cancelados.push(providerSubscriptionId);
    return super.cancelarAssinatura(providerSubscriptionId);
  }
  // cada assinatura nova com referência própria, como no Asaas
  override async criarAssinatura(...args: Parameters<SimuladorPaymentGateway['criarAssinatura']>) {
    const resposta = await super.criarAssinatura(...args);
    this.n += 1;
    return { ...resposta, providerSubscriptionId: `${resposta.providerSubscriptionId}-${this.n}` };
  }
}

interface Visao {
  status: string;
  bloqueada: boolean;
  emCarencia: boolean;
  subscribed: boolean;
  canceladaPorAtraso: boolean;
}

/**
 * Falta de pagamento (D91). O que precisa ficar provado: dentro da carência
 * nada é cancelado; no fim dela a assinatura é cancelada NO GATEWAY (para de
 * gerar fatura) e a oficina fica só para consulta; e ela só volta pagando —
 * assinar de novo, ou reativar, não abre carência nova. Não existe plano grátis.
 */
describe('assinatura cancelada por falta de pagamento', () => {
  let t: TestApp;
  const gateway = new GatewayQueAnota();
  const { db } = testDb();

  beforeAll(async () => {
    t = await createTestApp({}, { gateway });
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (s: TestSession, url: string, payload: unknown = {}) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const visao = async (s: TestSession) =>
    (await t.app.inject({ method: 'GET', url: '/api/v1/billing', headers: bearer(s.accessToken) })).json() as Visao;
  const forcar = (organizationId: string, patch: string) =>
    withTenant(db, { organizationId }, (tx) =>
      tx.execute(sql.raw(`update subscriptions set ${patch} where organization_id = '${organizationId}'`)),
    );
  const ref = async (organizationId: string) => {
    const { rows } = await withTenant(db, { organizationId }, (tx) =>
      tx.execute<{ provider_subscription_id: string }>(
        sql.raw(`select provider_subscription_id from subscriptions where organization_id = '${organizationId}'`),
      ),
    );
    return rows[0]!.provider_subscription_id;
  };
  const avisar = (providerSubscriptionId: string, event = 'PAYMENT_RECEIVED') =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/simulador',
      payload: { event, providerChargeId: `pay-${randomUUID()}`, providerSubscriptionId, amountCents: 14_900 },
    });
  const grava = async (s: TestSession) => (await post(s, '/api/v1/customers', { name: `Cliente ${randomUUID()}` })).statusCode;

  /** Oficina que assinou, pagou a primeira e deixou a segunda vencer. */
  const emAtraso = async () => {
    const dono = await signup(t.app);
    const doc = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: { document: '11.222.333/0001-81' },
    });
    expect(doc.statusCode, doc.body).toBe(200);
    const assinou = await post(dono, '/api/v1/billing/subscribe', {
      clientRequestId: randomUUID(),
      plan: 'TURBO',
      cycle: 'MONTHLY',
    });
    expect(assinou.statusCode, assinou.body).toBe(200);
    const sub = await ref(dono.orgId);
    await avisar(sub);
    await avisar(sub, 'PAYMENT_OVERDUE');
    expect((await visao(dono)).status).toBe('PAST_DUE');
    return { dono, sub };
  };

  /** O tempo passando: o atraso começou há `dias` dias. */
  const atrasoHa = async (organizationId: string, dias: number) => {
    await forcar(organizationId, `past_due_since = now() - interval '${dias} days'`);
    t.app.caches.subscriptions.delete(organizationId);
  };

  it('dentro da carência, nada é cancelado', async () => {
    const { dono, sub } = await emAtraso();
    await atrasoHa(dono.orgId, GRACE_DAYS - 1);
    await t.app.services.automations.tick(dono.orgId);

    expect(gateway.cancelados).not.toContain(sub);
    const dados = await visao(dono);
    expect(dados.status).toBe('PAST_DUE');
    expect(dados.emCarencia).toBe(true);
    expect(await grava(dono)).toBe(201);
  });

  it('no fim da carência, o trabalhador cancela no gateway e a oficina fica só para consulta', async () => {
    const { dono, sub } = await emAtraso();
    await atrasoHa(dono.orgId, GRACE_DAYS + 1);
    await t.app.services.automations.tick(dono.orgId);

    expect(gateway.cancelados, 'a recorrência para de gerar fatura').toContain(sub);
    const dados = await visao(dono);
    expect(dados.status).toBe('EXPIRED');
    expect(dados.canceladaPorAtraso).toBe(true);
    expect(dados.bloqueada).toBe(true);
    expect(dados.subscribed, 'o botão volta a ser "Assinar"').toBe(false);
    expect(await grava(dono)).toBe(402);

    // a próxima volta não cancela de novo
    const antes = gateway.cancelados.length;
    expect(await t.app.services.billing.cancelarSeInadimplente(dono.orgId)).toBe(false);
    expect(gateway.cancelados.length).toBe(antes);
  });

  it('só volta pagando: assinar de novo não destrava, e a fatura nova vencida não dá carência nova', async () => {
    const { dono } = await emAtraso();
    await atrasoHa(dono.orgId, GRACE_DAYS + 1);
    await t.app.services.billing.cancelarSeInadimplente(dono.orgId);

    const voltou = await post(dono, '/api/v1/billing/subscribe', {
      clientRequestId: randomUUID(),
      plan: 'TURBO',
      cycle: 'MONTHLY',
    });
    expect(voltou.statusCode, voltou.body).toBe(200);
    const nova = await ref(dono.orgId);
    const assinada = await visao(dono);
    expect(assinada.subscribed).toBe(true);
    expect(assinada.canceladaPorAtraso).toBe(false);
    expect(assinada.bloqueada, 'assinou, mas ainda não pagou').toBe(true);
    expect(await grava(dono)).toBe(402);

    // não pagou a fatura nova: continua travada, sem mais 7 dias
    await avisar(nova, 'PAYMENT_OVERDUE');
    t.app.caches.subscriptions.delete(dono.orgId);
    const vencida = await visao(dono);
    expect(vencida.status).toBe('PAST_DUE');
    expect(vencida.bloqueada).toBe(true);
    expect(await grava(dono)).toBe(402);

    // pagou: libera na hora
    await avisar(nova);
    const paga = await visao(dono);
    expect(paga.status).toBe('ACTIVE');
    expect(paga.bloqueada).toBe(false);
    expect(await grava(dono)).toBe(201);
  });

  it('reativar depois do fim do período pago não dá carência: trava até pagar', async () => {
    const { dono } = await emAtraso();
    // pagou, depois cancelou, e o período acabou
    await avisar(await ref(dono.orgId));
    expect((await post(dono, '/api/v1/billing/cancel', {})).statusCode).toBe(200);
    await forcar(dono.orgId, `current_period_end = now() - interval '1 day'`);
    t.app.caches.subscriptions.delete(dono.orgId);
    expect((await visao(dono)).bloqueada).toBe(true);

    const reativou = await post(dono, '/api/v1/billing/resume', {});
    expect(reativou.statusCode, reativou.body).toBe(200);
    const dados = reativou.json() as Visao;
    expect(dados.bloqueada, 'antes ganhava 7 dias de carência de graça').toBe(true);
    expect(dados.subscribed).toBe(true);
    expect(await grava(dono)).toBe(402);

    // a cobrança da reativação venceu: continua travada, sem carência nova
    await avisar(await ref(dono.orgId), 'PAYMENT_OVERDUE');
    t.app.caches.subscriptions.delete(dono.orgId);
    const vencida = await visao(dono);
    expect(vencida.status).toBe('PAST_DUE');
    expect(vencida.bloqueada).toBe(true);

    await avisar(await ref(dono.orgId));
    expect((await visao(dono)).bloqueada).toBe(false);
  });
});
