import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface TestPayment {
  id: string;
  method: string;
  amountCents: number;
  status: string;
  cancelReason: string | null;
  recordedByName: string | null;
}
interface TestPaymentList {
  data: TestPayment[];
  paidCents: number;
  balanceCents: number;
}

/**
 * Pagamento (MVP 1): a oficina registra o que recebeu. O que importa provar é
 * que `paid_cents` e `payment_status` saem SEMPRE da soma dos lançamentos
 * confirmados — nunca de um valor mandado pela tela.
 */
describe('pagamento da OS', () => {
  let t: TestApp;
  let owner: TestSession;
  let mecanico: TestSession;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    mecanico = await addMember(t.app, owner, 'MECHANIC', 'Zé Mecânico');
    const service = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de pastilhas', priceCents: 18000 },
    });
    serviceId = service.json().id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  let placas = 0;
  function nextPlate(): string {
    placas += 1;
    return `PAG${placas % 10}A${String(placas % 100).padStart(2, '0')}`;
  }

  const os = async (number: number) => (await get(`/api/v1/work-orders/${number}`)).json();

  /** OS aprovada de R$ 180,00: o valor devido é o que o cliente aprovou. */
  async function osAprovada() {
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    const decisao = await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect(decisao.statusCode, decisao.body).toBe(200);
    return order;
  }

  it('pagamento parcial deixa a OS em PARCIAL, com o saldo certo', async () => {
    const order = await osAprovada();

    // ainda não entregue: sinal e adiantamento são comuns e valem
    const res = await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'PIX', amountCents: 10000 });
    expect(res.statusCode, res.body).toBe(201);

    const lista = res.json() as TestPaymentList;
    expect(lista.paidCents).toBe(10000);
    expect(lista.balanceCents, 'R$ 180,00 aprovados menos R$ 100,00 pagos').toBe(8000);
    expect(lista.data[0]?.recordedByName, 'fica registrado quem recebeu').not.toBeNull();

    const ficha = await os(order.number);
    expect(ficha.paymentStatus).toBe('PARTIAL');
    expect(ficha.totals.paidCents).toBe(10000);
  });

  it('pagamento acima do saldo é recusado', async () => {
    const order = await osAprovada();
    await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'CASH', amountCents: 10000 });

    const res = await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'CASH', amountCents: 9000 });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().code).toBe('PAYMENT_EXCEEDS_BALANCE');
    // o saldo não se mexeu
    expect((await os(order.number)).totals.paidCents).toBe(10000);
  });

  it('completar o saldo marca a OS como paga', async () => {
    const order = await osAprovada();
    await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'PIX', amountCents: 10000 });
    const res = await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'DEBIT_CARD', amountCents: 8000 });
    expect(res.statusCode, res.body).toBe(201);

    const lista = res.json() as TestPaymentList;
    expect(lista.paidCents).toBe(18000);
    expect(lista.balanceCents).toBe(0);
    expect((await os(order.number)).paymentStatus).toBe('PAID');
  });

  it('cancelar um lançamento reabre o saldo e mantém o histórico', async () => {
    const order = await osAprovada();
    await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'PIX', amountCents: 10000 });
    const segundo = (
      await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'CASH', amountCents: 8000 })
    ).json() as TestPaymentList;
    expect((await os(order.number)).paymentStatus).toBe('PAID');

    const emDinheiro = segundo.data.find((p) => p.amountCents === 8000) as TestPayment;
    const res = await post(`/api/v1/payments/${emDinheiro.id}/cancel`, { reason: 'Lançado em duplicidade' });
    expect(res.statusCode, res.body).toBe(200);

    const lista = res.json() as TestPaymentList;
    expect(lista.paidCents, 'o cancelado não conta').toBe(10000);
    expect(lista.balanceCents).toBe(8000);
    expect((await os(order.number)).paymentStatus).toBe('PARTIAL');

    // o lançamento não some: fica na lista, marcado e com motivo
    const cancelado = lista.data.find((p) => p.id === emDinheiro.id) as TestPayment;
    expect(cancelado.status).toBe('CANCELED');
    expect(cancelado.cancelReason).toBe('Lançado em duplicidade');

    // e o estorno entra na timeline do carro, não só na auditoria interna:
    // é ali que a oficina lê o que aconteceu
    const timeline = (await get(`/api/v1/work-orders/${order.id}/timeline`)).json().data as {
      type: string;
      data: Record<string, unknown>;
    }[];
    const estorno = timeline.find((evento) => evento.type === 'PAYMENT' && evento.data.canceled === true);
    expect(estorno, 'o cancelamento precisa aparecer na timeline').toBeDefined();
    expect(estorno?.data.amountCents).toBe(8000);
  });

  it('cancelar duas vezes o mesmo lançamento é recusado', async () => {
    const order = await osAprovada();
    const lista = (
      await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'PIX', amountCents: 5000 })
    ).json() as TestPaymentList;
    const pagamento = lista.data[0] as TestPayment;

    expect((await post(`/api/v1/payments/${pagamento.id}/cancel`, { reason: 'Erro de digitação' })).statusCode).toBe(200);
    const denovo = await post(`/api/v1/payments/${pagamento.id}/cancel`, { reason: 'Erro de digitação' });
    expect(denovo.statusCode, denovo.body).toBe(409);
    expect(denovo.json().code).toBe('PAYMENT_ALREADY_CANCELED');
  });

  it('o mecânico não registra pagamento', async () => {
    const order = await osAprovada();
    const res = await post(
      `/api/v1/work-orders/${order.id}/payments`,
      { method: 'CASH', amountCents: 1000 },
      mecanico,
    );
    expect(res.statusCode).toBe(403);
  });
});
