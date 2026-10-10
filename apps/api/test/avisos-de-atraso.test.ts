import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import { etapaDoAtraso } from '../src/modules/billing/avisos-de-atraso';
import { bearer, createTestApp, signup, testDb, type TestApp, type TestSession } from './helpers';

/**
 * Os avisos de que o sistema vai ficar só para consulta. O que precisa ficar
 * provado: o atraso avisa no vencimento, 2 dias antes de travar e quando
 * trava; cada aviso sai uma vez POR ATRASO (o de março não é engolido pelo de
 * novembro); nada sai de madrugada; o link de pagar é o da fatura EM ABERTO,
 * não o da primeira; e quem terminou o teste sem assinar também é avisado
 * antes de travar.
 */
const DIA = 86_400_000;
/** 10h em São Paulo (13h UTC). */
const DEZ_DA_MANHA = new Date('2026-11-10T13:00:00Z');
/** 3h da manhã em São Paulo. */
const MADRUGADA = new Date('2026-11-10T06:00:00Z');
const ha = (ms: number) => new Date(DEZ_DA_MANHA.getTime() - ms);

describe('etapa do atraso', () => {
  const atraso = (ms: number) => ({
    status: 'PAST_DUE',
    pastDueSince: ha(ms),
    trialEndsAt: null,
    providerSubscriptionId: 'sub_1',
  });
  const testeAcabou = (ms: number, providerSubscriptionId: string | null = null) => ({
    status: 'TRIALING',
    pastDueSince: null,
    trialEndsAt: ha(ms),
    providerSubscriptionId,
  });

  it('mensalidade: venceu, vai travar, travou', () => {
    expect(etapaDoAtraso(atraso(3_600_000), DEZ_DA_MANHA)?.etapa).toBe('PAGAMENTO_PENDENTE');
    expect(etapaDoAtraso(atraso(5.5 * DIA), DEZ_DA_MANHA)?.etapa).toBe('TRAVA_EM_2_DIAS');
    expect(etapaDoAtraso(atraso(7.5 * DIA), DEZ_DA_MANHA)?.etapa).toBe('SISTEMA_TRAVADO');
    expect(etapaDoAtraso(atraso(15 * DIA), DEZ_DA_MANHA), 'travou há muito tempo: não manda atrasado').toBeNull();
  });

  it('teste sem assinatura: o fim do teste já tem e-mail; avisa antes de travar e quando trava', () => {
    expect(etapaDoAtraso(testeAcabou(DIA), DEZ_DA_MANHA)).toBeNull();
    expect(etapaDoAtraso(testeAcabou(5.5 * DIA), DEZ_DA_MANHA)?.etapa).toBe('TRAVA_EM_2_DIAS');
    expect(etapaDoAtraso(testeAcabou(7.5 * DIA), DEZ_DA_MANHA)?.etapa).toBe('SISTEMA_TRAVADO');
    expect(etapaDoAtraso(testeAcabou(-DIA), DEZ_DA_MANHA), 'ainda em teste').toBeNull();
  });

  it('quem assinou no teste é contado pelo atraso do gateway, não pelo fim do teste', () => {
    expect(etapaDoAtraso(testeAcabou(5.5 * DIA, 'sub_1'), DEZ_DA_MANHA)).toBeNull();
  });

  it('em dia não recebe nada', () => {
    expect(
      etapaDoAtraso({ status: 'ACTIVE', pastDueSince: null, trialEndsAt: null, providerSubscriptionId: 'sub_1' }, DEZ_DA_MANHA),
    ).toBeNull();
  });
});

describe('avisos de atraso', () => {
  let t: TestApp;
  let dono: TestSession;
  let ref: string;
  const { db } = testDb();
  const FATURA_DA_RENOVACAO = 'https://www.asaas.com/i/renovacao-de-novembro';

  const forcar = (organizationId: string, patch: string) =>
    withTenant(db, { organizationId }, (tx) =>
      tx.execute(sql.raw(`update subscriptions set ${patch} where organization_id = '${organizationId}'`)),
    );
  const atrasadoDesde = (organizationId: string, quando: Date) =>
    forcar(organizationId, `status = 'PAST_DUE', past_due_since = '${quando.toISOString()}'`);
  const enviados = (s: TestSession) => t.email.sent.filter((m) => m.to === s.email);
  const avisar = (extra: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/simulador',
      payload: { providerSubscriptionId: ref, externalId: `evt-${randomUUID()}`, amountCents: 14_900, ...extra },
    });
  const pagina = async () =>
    (
      (await t.app.inject({ method: 'GET', url: '/api/v1/billing', headers: bearer(dono.accessToken) })).json() as {
        checkoutUrl: string | null;
      }
    ).checkoutUrl;
  const avisos = () => t.app.services.avisosDeAtraso;

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app, { name: 'Sandra Moreira', organizationName: 'Moreira Auto Center' });
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
      payload: { clientRequestId: randomUUID(), plan: 'TURBO', cycle: 'MONTHLY' },
    });
    expect(assinou.statusCode, assinou.body).toBe(200);
    const { rows } = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ ref: string }>(
        sql`select provider_subscription_id as ref from subscriptions where organization_id = ${dono.orgId}`,
      ),
    );
    ref = rows[0]!.ref;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('o botão de pagar acompanha a fatura em aberto, e some quando ela é paga', async () => {
    const fatura = `pay-${randomUUID()}`;
    await avisar({ event: 'PAYMENT_CREATED', providerChargeId: fatura, invoiceUrl: FATURA_DA_RENOVACAO });
    expect(await pagina(), 'a renovação nova, não a primeira fatura').toBe(FATURA_DA_RENOVACAO);

    // o aviso de vencida não traz o link: o da fatura já guardado continua
    const vencida = await avisar({ event: 'PAYMENT_OVERDUE', providerChargeId: fatura });
    expect((vencida.json() as { reason: string }).reason).toBe('assinatura em atraso');
    expect(await pagina()).toBe(FATURA_DA_RENOVACAO);
  });

  it('venceu: avisa uma vez, com o link da fatura e o dia em que trava', async () => {
    await atrasadoDesde(dono.orgId, ha(3_600_000));
    expect(await avisos().enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('PAGAMENTO_PENDENTE');
    expect(await avisos().enviarDevido(dono.orgId, DEZ_DA_MANHA), 'não repete').toBeNull();

    const email = enviados(dono).at(-1)!;
    expect(email.subject).toBe('Não identificamos o pagamento do OficinaOS');
    expect(email.text).toContain('Olá, Sandra!');
    expect(email.text).toContain('mensalidade do plano Turbo');
    expect(email.text).toContain(FATURA_DA_RENOVACAO);
    expect(email.text, 'trava 7 dias depois do vencimento').toContain('até 17/11');
    expect(email.text).toContain('se você já pagou, desconsidere');
  });

  it('de madrugada não manda; 2 dias antes de travar, avisa', async () => {
    await atrasadoDesde(dono.orgId, ha(5.5 * DIA));
    expect(await avisos().enviarDevido(dono.orgId, MADRUGADA)).toBeNull();
    expect(await avisos().enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('TRAVA_EM_2_DIAS');
    const email = enviados(dono).at(-1)!;
    expect(email.subject).toMatch(/^O OficinaOS fica só para consulta em \d\d\/\d\d$/);
    expect(email.text).toContain('Nada é apagado');
  });

  it('travou: diz que os dados estão lá e como liberar', async () => {
    await atrasadoDesde(dono.orgId, ha(7.5 * DIA));
    expect(await avisos().enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBe('SISTEMA_TRAVADO');
    const email = enviados(dono).at(-1)!;
    expect(email.subject).toBe('Seu OficinaOS está só para consulta (seus dados estão seguros)');
    expect(email.text).toContain('continuam todos lá');
    expect(email.text).toContain(FATURA_DA_RENOVACAO);
  });

  it('pagou: volta ao normal, o botão some e nada mais é enviado', async () => {
    const fatura = `pay-${randomUUID()}`;
    await avisar({ event: 'PAYMENT_CREATED', providerChargeId: fatura, invoiceUrl: FATURA_DA_RENOVACAO });
    const paga = await avisar({ event: 'PAYMENT_RECEIVED', providerChargeId: fatura, invoiceUrl: FATURA_DA_RENOVACAO });
    expect((paga.json() as { reason: string }).reason).toBe('assinatura renovada');
    expect(await pagina()).toBeNull();
    expect(await avisos().enviarDevido(dono.orgId, DEZ_DA_MANHA)).toBeNull();
  });

  it('um atraso novo, meses depois, avisa de novo', async () => {
    const depois = new Date(DEZ_DA_MANHA.getTime() + 120 * DIA);
    await atrasadoDesde(dono.orgId, new Date(depois.getTime() - 3_600_000));
    expect(await avisos().enviarDevido(dono.orgId, depois)).toBe('PAGAMENTO_PENDENTE');
  });

  it('terminou o teste sem assinar: avisa 2 dias antes de travar', async () => {
    const outra = await signup(t.app, { name: 'Jorge Pacheco' });
    await forcar(outra.orgId, `trial_ends_at = '${ha(5.5 * DIA).toISOString()}'`);
    expect(await avisos().enviarDevido(outra.orgId, DEZ_DA_MANHA)).toBe('TRAVA_EM_2_DIAS');
    const email = enviados(outra).at(-1)!;
    expect(email.text).toContain('O teste grátis');
    expect(email.text).toContain('/configuracoes/plano');
    expect(email.text, 'quem não assinou não tem fatura').not.toContain('Pagar agora');
  });
});
