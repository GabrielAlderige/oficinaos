import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withTenant } from '../src/db/tenant';
import { SimuladorPaymentGateway } from '../src/integrations/payments/gateway';
import { deveAvisar, deveReajustar } from '../src/modules/billing/fim-da-fundadora';
import { bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

/**
 * O fim do preço de fundadora (D92). O que precisa ficar provado: o dono é
 * avisado 30 dias antes, com a data e o valor novo; o valor sobe no gateway
 * 20 dias antes (o Asaas gera a fatura adiantado), só a partir da data
 * combinada; cada coisa acontece uma vez; e quem já não paga o preço de
 * fundadora não é mexido.
 */
const DIA = 86_400_000;
/** 10h em São Paulo (13h UTC). */
const DEZ_DA_MANHA = new Date('2028-01-10T13:00:00Z');
const daqui = (dias: number) => new Date(DEZ_DA_MANHA.getTime() + dias * DIA);

describe('quando avisar e quando reajustar', () => {
  const fundadora = (dias: number, extra: Record<string, unknown> = {}) => ({
    status: 'ACTIVE',
    providerSubscriptionId: 'sub_1',
    founderPriceCents: 27_900,
    founderPriceUntil: daqui(dias),
    priceCents: 27_900,
    billingCycle: 'MONTHLY',
    plano: 'NITRO',
    ...extra,
  });

  it('avisa a partir de 30 dias antes, e reajusta a partir de 20', () => {
    expect(deveAvisar(fundadora(31), DEZ_DA_MANHA)).toBe(false);
    expect(deveAvisar(fundadora(29), DEZ_DA_MANHA)).toBe(true);
    expect(deveReajustar(fundadora(25), DEZ_DA_MANHA)).toBe(false);
    expect(deveReajustar(fundadora(19), DEZ_DA_MANHA)).toBe(true);
  });

  it('data passada sem reajuste ainda reajusta; o aviso não sai depois da data', () => {
    expect(deveReajustar(fundadora(-5), DEZ_DA_MANHA)).toBe(true);
    expect(deveAvisar(fundadora(-1), DEZ_DA_MANHA)).toBe(false);
  });

  it('quem não paga mais o preço de fundadora não é mexido', () => {
    expect(deveReajustar(fundadora(10, { priceCents: 49_900 }), DEZ_DA_MANHA), 'já reajustado').toBe(false);
    expect(deveReajustar(fundadora(10, { plano: 'SUPERCHARGER', priceCents: 27_900 }), DEZ_DA_MANHA)).toBe(false);
    expect(deveReajustar(fundadora(10, { billingCycle: 'YEARLY' }), DEZ_DA_MANHA)).toBe(false);
    expect(deveReajustar(fundadora(10, { status: 'CANCELED' }), DEZ_DA_MANHA)).toBe(false);
    expect(deveReajustar(fundadora(10, { providerSubscriptionId: null }), DEZ_DA_MANHA), 'nunca assinou').toBe(false);
    expect(deveReajustar(fundadora(10, { founderPriceCents: null }), DEZ_DA_MANHA), 'não é fundadora').toBe(false);
  });
});

describe('fim do preço de fundadora', () => {
  let t: TestApp;
  let dono: TestSession;
  const { db } = testDb();

  const forcar = (patch: string) =>
    withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(sql.raw(`update subscriptions set ${patch} where organization_id = '${dono.orgId}'`)),
    );
  const fundadora = () => t.app.services.fimDaFundadora;
  const enviados = () => t.email.sent.filter((m) => m.to === dono.email);
  const visao = async () =>
    (await t.app.inject({ method: 'GET', url: '/api/v1/billing', headers: bearer(dono.accessToken) })).json() as {
      priceCents: number;
    };

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app, { name: 'Paulo Fundador', organizationName: 'Auto Center Fundador' });
    await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: { document: '11.222.333/0001-81' },
    });
    const assinou = await t.app.inject({
      method: 'POST',
      url: '/api/v1/billing/subscribe',
      headers: bearer(dono.accessToken),
      payload: { clientRequestId: randomUUID(), plan: 'NITRO', cycle: 'MONTHLY' },
    });
    expect(assinou.statusCode, assinou.body).toBe(200);
    // fundadora pagando os R$ 279, com o fim do preço daqui a 25 dias
    await forcar(
      `status = 'ACTIVE', price_cents = 27900, founder_price_cents = 27900, founder_price_until = '${daqui(25).toISOString()}'`,
    );
  });
  afterAll(async () => {
    await t.app.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('30 dias antes: o dono recebe a data e o valor novo, uma vez só', async () => {
    expect(await fundadora().avisarSeDevido(dono.orgId, DEZ_DA_MANHA)).toBe(true);
    expect(await fundadora().avisarSeDevido(dono.orgId, DEZ_DA_MANHA), 'não repete').toBe(false);

    const email = enviados().at(-1)!;
    expect(email.subject).toBe('Seu preço de fundadora do OficinaOS termina em 04/02');
    expect(email.text.replaceAll(String.fromCharCode(0xa0), ' ')).toContain('passa de R$ 279,00 para R$ 499,00 por mês');
    expect(email.text).toContain('/configuracoes/plano');
  });

  it('de madrugada o aviso espera', async () => {
    await forcar(`founder_price_until = '${daqui(26).toISOString()}'`);
    const madrugada = new Date('2028-01-10T06:00:00Z');
    expect(await fundadora().avisarSeDevido(dono.orgId, madrugada)).toBe(false);
    await forcar(`founder_price_until = '${daqui(25).toISOString()}'`);
  });

  it('antes dos 20 dias o valor não muda', async () => {
    const reajuste = vi.spyOn(SimuladorPaymentGateway.prototype, 'reajustarAssinatura');
    expect(await fundadora().reajustarSeChegou(dono.orgId, DEZ_DA_MANHA)).toBe(false);
    expect(reajuste).not.toHaveBeenCalled();
    expect((await visao()).priceCents).toBe(27_900);
  });

  it('20 dias antes: sobe para a tabela no gateway, a partir da data combinada, uma vez só', async () => {
    const reajuste = vi.spyOn(SimuladorPaymentGateway.prototype, 'reajustarAssinatura');
    const vinteDiasAntes = daqui(6);
    expect(await fundadora().reajustarSeChegou(dono.orgId, vinteDiasAntes)).toBe(true);
    expect(reajuste).toHaveBeenCalledTimes(1);
    expect(reajuste.mock.calls[0]![1]).toEqual({ amountCents: 49_900, aPartirDe: '2028-02-04' });
    expect((await visao()).priceCents, 'a tela mostra o valor novo').toBe(49_900);

    expect(await fundadora().reajustarSeChegou(dono.orgId, vinteDiasAntes), 'não reajusta de novo').toBe(false);
    expect(reajuste).toHaveBeenCalledTimes(1);

    const { rows } = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ action: string }>(
        sql`select action from activity_logs where organization_id = ${dono.orgId} and action = 'subscription.founder_price_ended'`,
      ),
    );
    expect(rows.length, 'fica na trilha da oficina').toBe(1);
  });

  it('se o gateway falhar, nada muda aqui e a próxima volta tenta de novo', async () => {
    await forcar('price_cents = 27900');
    vi.spyOn(SimuladorPaymentGateway.prototype, 'reajustarAssinatura').mockRejectedValueOnce(new Error('Asaas fora'));
    await expect(fundadora().reajustarSeChegou(dono.orgId, daqui(6))).rejects.toThrow('Asaas fora');
    expect((await visao()).priceCents).toBe(27_900);
    expect(await fundadora().reajustarSeChegou(dono.orgId, daqui(6))).toBe(true);
  });

  it('a volta de hora em hora faz o reajuste sozinha', async () => {
    await forcar(`price_cents = 27900, founder_price_until = '${new Date(Date.now() + 10 * DIA).toISOString()}'`);
    t.app.caches.subscriptions.delete(dono.orgId);
    await t.app.services.automations.tick(dono.orgId);
    expect((await visao()).priceCents).toBe(49_900);
  });
});
