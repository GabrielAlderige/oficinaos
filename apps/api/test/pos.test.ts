import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Maquininha, PedidoParaMaquininha, SituacaoNaMaquininha } from '../src/integrations/payments/maquininha';
import { bearer, createCustomer, createPart, createTestApp, createVehicle, createWorkOrder, signup, type TestApp, type TestSession } from './helpers';

interface Cobranca {
  id: string;
  status: string;
  environment: string;
  amountCents: number;
  paidAmountCents: number | null;
  cardBrand: string | null;
  failureReason: string | null;
}

const pendente: SituacaoNaMaquininha = {
  status: 'PENDING',
  paidAmountCents: null,
  paidAt: null,
  chargeId: null,
  cardBrand: null,
  authorizationCode: null,
  failureReason: null,
  raw: {},
};

/** A Stone de mentira: guarda os pedidos e responde a situação que o teste mandar. */
class StoneDeTeste implements Maquininha {
  readonly driver = 'stone';
  readonly environment = 'PRODUCTION' as const;
  pedidos: PedidoParaMaquininha[] = [];
  situacao = new Map<string, SituacaoNaMaquininha>();
  fechados: [string, string][] = [];
  consultas = 0;

  async criar(pedido: PedidoParaMaquininha) {
    this.pedidos.push(pedido);
    const orderId = `or_${this.pedidos.length}_${pedido.ref.slice(0, 6)}`;
    this.situacao.set(orderId, pendente);
    return { orderId, raw: { id: orderId } };
  }
  async consultar(orderId: string) {
    this.consultas += 1;
    return this.situacao.get(orderId) ?? pendente;
  }
  async fechar(orderId: string, status: string) {
    this.fechados.push([orderId, status]);
  }
  ultimoPedido() {
    return `or_${this.pedidos.length}_${this.pedidos.at(-1)!.ref.slice(0, 6)}`;
  }
  pagar(orderId: string, valor: number) {
    this.situacao.set(orderId, { ...pendente, status: 'PAID', paidAmountCents: valor, paidAt: new Date(), chargeId: 'ch_1', cardBrand: 'Visa', authorizationCode: '123456' });
  }
}

/**
 * Maquininha Stone (E50).
 *
 * O que precisa ficar provado: a chave da oficina é guardada cifrada e nunca
 * volta; sem parceiro Stone tudo roda no simulador; a cobrança não passa do
 * saldo; o pagamento vira lançamento no caixa UMA vez, venha da tela ou do
 * aviso (repetido ou não); o aviso só aponta — quem decide é a consulta; o
 * pedido pago é fechado na Stone; estorno na maquininha desfaz o lançamento;
 * cancelar tira o pedido da maquininha.
 */
describe('maquininha Stone', () => {
  let semParceiro: TestApp;
  let t: TestApp;
  let dono: TestSession;
  let donoSim: TestSession;
  const stone = new StoneDeTeste();
  const chaves: string[] = [];
  let peca: string;

  const req = (app: TestApp, s: TestSession) => ({
    post: (url: string, payload: unknown = {}) => app.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never }),
    put: (url: string, payload: unknown) => app.app.inject({ method: 'PUT', url, headers: bearer(s.accessToken), payload: payload as never }),
    get: (url: string) => app.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) }),
  });
  const aviso = (orderId: string, type = 'charge.paid') =>
    t.app.inject({ method: 'POST', url: '/api/v1/webhooks/stone', payload: { type, data: { id: 'ch_1', order: { id: orderId } } } });

  async function osParaCobrar(s: TestSession, app: TestApp, valor: number) {
    const r = req(app, s);
    const cliente = await createCustomer(app.app, s, { name: 'Paula Reis', email: 'paula@exemplo.com' });
    const veiculo = await createVehicle(app.app, s, cliente.id, { plate: `POS${Math.floor(Math.random() * 9)}A${Math.floor(Math.random() * 90 + 10)}`, make: 'VW', model: 'Gol' });
    const os = await createWorkOrder(app.app, s, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', description: 'Alinhamento', quantity: 1, unitPriceCents: valor }],
    });
    const orcamento = await r.post(`/api/v1/work-orders/${os.id}/quotes`);
    await r.post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    return os.id;
  }
  const pagoNaOs = async (app: TestApp, s: TestSession, os: string) =>
    (await req(app, s).get(`/api/v1/work-orders/${os}/payments`)).json() as { paidCents: number; balanceCents: number; data: { status: string }[] };

  beforeAll(async () => {
    semParceiro = await createTestApp();
    donoSim = await signup(semParceiro.app);
    t = await createTestApp(
      { STONE_SERVICE_REFERER_NAME: 'parceiro-teste' },
      {
        maquininhaDaOficina: (opcoes) => {
          chaves.push(opcoes.secretKey);
          return stone;
        },
      },
    );
    dono = await signup(t.app);
    peca = (await createPart(semParceiro.app, donoSim, { name: 'Palheta', salePriceCents: 5_000, initialQuantity: 10, initialUnitCostCents: 2_000 })).id;
  });
  afterAll(async () => {
    await semParceiro.app.close();
    await t.app.close();
  });

  it('a chave é guardada cifrada, nunca volta inteira, e sem parceiro Stone fica no simulador', async () => {
    const r = req(semParceiro, donoSim);
    const inicial = (await r.get('/api/v1/pos/settings')).json();
    expect(inicial).toMatchObject({ provider: 'simulador', partnerReady: false, devices: [] });
    const salvo = await r.put('/api/v1/pos/settings', {
      secretKey: 'sk_live_abcdefgh12345678WXYZ',
      devices: [{ serial: '6c568971', name: 'Balcão' }],
    });
    expect(salvo.statusCode, salvo.body).toBe(200);
    expect(salvo.json()).toMatchObject({ provider: 'stone', keyHint: 'WXYZ', partnerReady: false, devices: [{ serial: '6C568971', name: 'Balcão' }] });
    expect(salvo.body).not.toContain('sk_live');
    expect((await r.get('/api/v1/pos/settings')).body).not.toContain('abcdefgh');
  });

  it('venda de balcão na maquininha (simulador): sem cliente, não passa do saldo, e o pagamento quita a venda uma vez só', async () => {
    const r = req(semParceiro, donoSim);
    const venda = await r.post('/api/v1/counter-sales', {
      clientRequestId: randomUUID(),
      items: [{ partId: peca, quantity: 2, unitPriceCents: 5_000 }],
      payment: { kind: 'POS' },
    });
    expect(venda.statusCode, venda.body).toBe(201);
    const vendaId = (venda.json() as { id: string }).id;
    expect((venda.json() as { paidCents: number }).paidCents, 'nasce em aberto').toBe(0);

    const corpo = { counterSaleId: vendaId, amountCents: 10_000, method: 'DEBIT_CARD', deviceSerial: '6C568971' };
    expect((await r.post('/api/v1/pos/charges', { ...corpo, deviceSerial: 'OUTRA123' , clientRequestId: randomUUID() })).statusCode, 'maquininha não cadastrada').toBe(422);
    expect((await r.post('/api/v1/pos/charges', { ...corpo, amountCents: 10_001, clientRequestId: randomUUID() })).statusCode, 'acima do saldo').toBe(422);
    expect((await r.post('/api/v1/pos/charges', { ...corpo, installments: 3, clientRequestId: randomUUID() })).statusCode, 'parcelar só no crédito').toBe(400);

    const criada = await r.post('/api/v1/pos/charges', { ...corpo, clientRequestId: randomUUID() });
    expect(criada.statusCode, criada.body).toBe(201);
    const cobranca = criada.json() as Cobranca;
    expect(cobranca).toMatchObject({ status: 'PENDING', environment: 'SIMULATOR' });
    expect(chaves, 'sem parceiro a chave nem é aberta').toHaveLength(0);

    expect((await r.post('/api/v1/pos/charges', { ...corpo, clientRequestId: randomUUID() })).statusCode, 'maquininha ocupada').toBe(409);

    const paga = await r.post(`/api/v1/pos/charges/${cobranca.id}/simulate-paid`);
    expect(paga.statusCode, paga.body).toBe(200);
    expect(paga.json()).toMatchObject({ status: 'PAID', paidAmountCents: 10_000 });
    expect((await r.post(`/api/v1/pos/charges/${cobranca.id}/simulate-paid`)).statusCode).toBe(200);
    const depois = (await r.get(`/api/v1/counter-sales/${vendaId}`)).json() as { paidCents: number };
    expect(depois.paidCents, 'repetir não paga duas vezes').toBe(10_000);
  });

  it('OS na Stone: a chave chega decifrada, o aviso faz a consulta, o pagamento entra no caixa da OS uma vez e o pedido é fechado', async () => {
    const r = req(t, dono);
    expect((await r.put('/api/v1/pos/settings', { secretKey: 'sk_live_chavedaoficina99', devices: [{ serial: 'ABC12345', name: 'Caixa' }] })).statusCode).toBe(200);
    const os = await osParaCobrar(dono, t, 30_000);
    const criada = await r.post('/api/v1/pos/charges', {
      clientRequestId: randomUUID(),
      workOrderId: os,
      amountCents: 30_000,
      method: 'CREDIT_CARD',
      installments: 3,
      deviceSerial: 'ABC12345',
    });
    expect(criada.statusCode, criada.body).toBe(201);
    const cobranca = criada.json() as Cobranca;
    expect(cobranca).toMatchObject({ status: 'PENDING', environment: 'PRODUCTION' });
    expect(chaves.at(-1)).toBe('sk_live_chavedaoficina99');
    expect(stone.pedidos.at(-1)).toMatchObject({ amountCents: 30_000, method: 'CREDIT_CARD', installments: 3, deviceSerial: 'ABC12345', customer: { name: 'Paula Reis', email: 'paula@exemplo.com' } });
    const orderId = stone.ultimoPedido();

    // aviso antes do pagamento (ou forjado): a consulta diz "esperando" e nada é lançado
    expect((await aviso(orderId)).json()).toMatchObject({ handled: false });
    expect((await pagoNaOs(t, dono, os)).paidCents).toBe(0);

    stone.pagar(orderId, 30_000);
    const r1 = await aviso(orderId);
    expect(r1.statusCode, r1.body).toBe(200);
    expect(r1.json()).toMatchObject({ handled: true, reason: 'pagamento lançado' });
    expect(await aviso(orderId), 'aviso repetido').toBeTruthy();
    await r.get(`/api/v1/pos/charges/${cobranca.id}`);
    const caixa = await pagoNaOs(t, dono, os);
    expect(caixa.paidCents, 'aviso repetido e tela não lançam duas vezes').toBe(30_000);
    expect(caixa.data.filter((p) => p.status === 'CONFIRMED')).toHaveLength(1);
    expect(stone.fechados).toContainEqual([orderId, 'paid']);
    expect((await r.get(`/api/v1/pos/charges/${cobranca.id}`)).json()).toMatchObject({ status: 'PAID', cardBrand: 'Visa' });

    // estorno feito na maquininha: o pagamento da OS é cancelado
    stone.situacao.set(orderId, { ...stone.situacao.get(orderId)!, status: 'REFUNDED' });
    expect((await aviso(orderId, 'charge.refunded')).json()).toMatchObject({ handled: true, reason: 'estorno lançado' });
    expect((await pagoNaOs(t, dono, os)).paidCents).toBe(0);
    expect((await r.get(`/api/v1/pos/charges/${cobranca.id}`)).json()).toMatchObject({ status: 'REFUNDED' });
  });

  it('a tela que pergunta acha o pagamento mesmo sem aviso', async () => {
    const r = req(t, dono);
    const os = await osParaCobrar(dono, t, 12_000);
    const cobranca = (
      await r.post('/api/v1/pos/charges', { clientRequestId: randomUUID(), workOrderId: os, amountCents: 12_000, method: 'PIX', deviceSerial: 'ABC12345' })
    ).json() as Cobranca;
    stone.pagar(stone.ultimoPedido(), 12_000);
    expect((await r.get(`/api/v1/pos/charges/${cobranca.id}`)).json()).toMatchObject({ status: 'PAID' });
    expect((await pagoNaOs(t, dono, os)).paidCents).toBe(12_000);
  });

  it('cancelar tira o pedido da maquininha; se o cliente já pagou, vale o pagamento', async () => {
    const r = req(t, dono);
    const os = await osParaCobrar(dono, t, 8_000);
    const primeira = (
      await r.post('/api/v1/pos/charges', { clientRequestId: randomUUID(), workOrderId: os, amountCents: 8_000, method: 'DEBIT_CARD', deviceSerial: 'ABC12345' })
    ).json() as Cobranca;
    const cancelada = await r.post(`/api/v1/pos/charges/${primeira.id}/cancel`);
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect(cancelada.json()).toMatchObject({ status: 'CANCELED' });
    expect(stone.fechados).toContainEqual([stone.ultimoPedido(), 'canceled']);

    const segunda = (
      await r.post('/api/v1/pos/charges', { clientRequestId: randomUUID(), workOrderId: os, amountCents: 8_000, method: 'DEBIT_CARD', deviceSerial: 'ABC12345' })
    ).json() as Cobranca;
    stone.pagar(stone.ultimoPedido(), 8_000);
    expect((await r.post(`/api/v1/pos/charges/${segunda.id}/cancel`)).statusCode, 'pago antes do cancelar').toBe(409);
    expect((await pagoNaOs(t, dono, os)).paidCents).toBe(8_000);
    expect((await r.post(`/api/v1/pos/charges/${segunda.id}/simulate-paid`)).statusCode, 'simular só no simulador').toBe(422);
  });

  it('aviso de pedido que não é nosso responde 200 e não faz nada', async () => {
    const r = await aviso('or_desconhecido');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ handled: false, reason: 'pedido desconhecido' });
    expect((await t.app.inject({ method: 'POST', url: '/api/v1/webhooks/stone', payload: { type: 'order.created', data: {} } })).json()).toMatchObject({ handled: false });
  });
});

describe('cliente Connect Stone (o que vai e o que volta da Pagar.me)', () => {
  it('pedido direto com Basic da chave, ServiceRefererName e a maquininha certa; o pedido pago é lido da charge', async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const respostas: unknown[] = [
      { id: 'or_abc', status: 'pending' },
      {
        id: 'or_abc',
        status: 'paid',
        closed: true,
        charges: [{ id: 'ch_9', status: 'paid', amount: 15_000, paid_amount: 15_000, paid_at: '2026-10-28T12:00:00Z', metadata: { scheme_name: 'Elo', authorization_code: '051659' } }],
      },
      {},
    ];
    const falso = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify(respostas.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const { StoneConnect } = await import('../src/integrations/payments/maquininha');
    const cliente = new StoneConnect({ secretKey: 'sk_live_x1', serviceRefererName: 'parceiro', fetch: falso });

    const { orderId } = await cliente.criar({
      ref: '0190aaaa-bbbb-cccc-dddd-eeeeffff0000',
      amountCents: 15_000,
      description: 'OS 42',
      method: 'CREDIT_CARD',
      installments: 2,
      deviceSerial: 'ABC12345',
      displayName: 'OS 42',
      customer: { name: 'Paula', email: 'p@x.com' },
    });
    expect(orderId).toBe('or_abc');
    const [criar] = chamadas;
    expect(criar!.url).toBe('https://api.pagar.me/core/v5/orders');
    const cabecalhos = criar!.init.headers as Record<string, string>;
    expect(cabecalhos.Authorization).toBe(`Basic ${Buffer.from('sk_live_x1:').toString('base64')}`);
    expect(cabecalhos.ServiceRefererName).toBe('parceiro');
    const corpo = JSON.parse(criar!.init.body as string);
    expect(corpo).toMatchObject({
      closed: false,
      items: [{ amount: 15_000, quantity: 1 }],
      poi_payment_settings: { devices_serial_number: ['ABC12345'], payment_setup: { type: 'credit', installments: 2, installment_type: 'merchant' } },
    });

    const situacao = await cliente.consultar('or_abc');
    expect(situacao).toMatchObject({ status: 'PAID', paidAmountCents: 15_000, cardBrand: 'Elo', authorizationCode: '051659', chargeId: 'ch_9' });

    await cliente.fechar('or_abc', 'paid');
    expect(chamadas[2]!.url).toBe('https://api.pagar.me/core/v5/orders/or_abc/closed');
    expect(chamadas[2]!.init.method).toBe('PATCH');
    expect(JSON.parse(chamadas[2]!.init.body as string)).toEqual({ status: 'paid' });
  });

  it('chave recusada vira mensagem em português; cartão recusado com o pedido aberto segue esperando outro cartão', async () => {
    const { StoneConnect, lerPedido } = await import('../src/integrations/payments/maquininha');
    const recusa = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await expect(new StoneConnect({ secretKey: 'sk_x', serviceRefererName: 'p', fetch: recusa }).consultar('or_1')).rejects.toThrow('Secret Key');
    const recusado = lerPedido({ status: 'pending', closed: false, charges: [{ id: 'ch_1', status: 'failed', last_transaction: { acquirer_message: 'Saldo insuficiente' } }] });
    expect(recusado).toMatchObject({ status: 'PENDING', failureReason: 'Saldo insuficiente' });
  });
});
