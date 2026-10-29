import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface Venda {
  id: string;
  number: number;
  status: string;
  totalCents: number;
  discountCents: number;
  paidCents: number;
  financialEntryId: string | null;
  items: { description: string; quantity: number; totalCents: number }[];
  negativeStock: { partId: string; name: string }[];
}

/**
 * Venda de balcão (E49).
 *
 * O que precisa ficar provado: a peça sai do estoque e a venda vira dinheiro
 * no financeiro NA MESMA operação; pago na hora nasce quitado, fiado nasce em
 * aberto; o POST repetido não vende duas vezes; cancelar devolve a peça e
 * cancela o dinheiro; e a venda entra no faturado e no lucro.
 */
describe('venda de balcão', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let oleo: string;
  let lampada: string;
  let cliente: string;

  const post = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const saldo = async (id: string) => (await get(`/api/v1/parts/${id}`)).json().quantityOnHand as number;
  const vender = (corpo: Record<string, unknown>, s: TestSession = dono) =>
    post('/api/v1/counter-sales', { clientRequestId: randomUUID(), ...corpo }, s);

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Carla do Balcão');
    oleo = (
      await createPart(t.app, dono, { name: 'Óleo 5W30 1L', salePriceCents: 4_500, initialQuantity: 20, initialUnitCostCents: 2_800 })
    ).id;
    lampada = (await createPart(t.app, dono, { name: 'Lâmpada H4', salePriceCents: 3_000, initialQuantity: 2, initialUnitCostCents: 1_200 }))
      .id;
    cliente = (await createCustomer(t.app, dono, { name: 'Marcos Lima' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('pago na hora: a peça sai do estoque e a conta nasce quitada', async () => {
    const res = await vender(
      {
        items: [
          { partId: oleo, quantity: 4, unitPriceCents: 4_500 },
          { partId: null, description: 'Troca rápida da lâmpada', quantity: 1, unitPriceCents: 2_000 },
        ],
        payment: { kind: 'PAID', method: 'PIX' },
      },
      atendente,
    );
    expect(res.statusCode, res.body).toBe(201);
    const venda = res.json() as Venda;
    expect(venda.totalCents, '4 × R$ 45 + R$ 20 de mão de obra').toBe(20_000);
    expect(venda.paidCents).toBe(20_000);
    expect(venda.number).toBe(1);
    expect(await saldo(oleo)).toBe(16);

    const conta = (await get(`/api/v1/finance/entries/${venda.financialEntryId}`)).json();
    expect(conta.origin).toBe('COUNTER_SALE');
    expect(conta.status).toBe('PAID');
    expect(conta.settlements).toHaveLength(1);
    expect(conta.settlements[0].method).toBe('PIX');
  });

  it('o mesmo POST repetido devolve a mesma venda e não tira a peça de novo', async () => {
    const corpo = {
      clientRequestId: randomUUID(),
      items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }],
      payment: { kind: 'PAID', method: 'CASH' },
    };
    const primeira = (await post('/api/v1/counter-sales', corpo)).json() as Venda;
    const segunda = await post('/api/v1/counter-sales', corpo);
    expect(segunda.statusCode).toBe(201);
    expect((segunda.json() as Venda).id).toBe(primeira.id);
    expect(await saldo(oleo)).toBe(15);
  });

  it('fiado: a conta nasce em aberto, com o vencimento combinado, e quitar depois funciona', async () => {
    const res = await vender({
      customerId: cliente,
      items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }],
      payment: { kind: 'LATER', dueDate: '2099-12-10' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const venda = res.json() as Venda;
    expect(venda.paidCents).toBe(0);
    const conta = (await get(`/api/v1/finance/entries/${venda.financialEntryId}`)).json();
    expect(conta.status).toBe('OPEN');
    expect(conta.dueDate).toBe('2099-12-10');

    const baixa = await post(`/api/v1/finance/entries/${venda.financialEntryId}/settlements`, {
      clientRequestId: randomUUID(),
      amountCents: 4_500,
      method: 'PIX',
    });
    expect(baixa.statusCode, baixa.body).toBe(201);
    expect(baixa.json().status).toBe('PAID');
  });

  it('fiado sem cliente é recusado: não há de quem cobrar', async () => {
    const res = await vender({
      items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }],
      payment: { kind: 'LATER', dueDate: '2099-12-10' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('vender mais do que tem não trava o balcão, mas avisa do saldo negativo', async () => {
    const res = await vender({
      items: [{ partId: lampada, quantity: 3, unitPriceCents: 3_000 }],
      payment: { kind: 'PAID', method: 'CASH' },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as Venda).negativeStock.map((p) => p.name)).toEqual(['Lâmpada H4']);
    expect(await saldo(lampada)).toBe(-1);
  });

  it('cancelar devolve a peça, cancela a baixa e a conta; e não cancela duas vezes', async () => {
    const venda = (
      await vender({ items: [{ partId: oleo, quantity: 2, unitPriceCents: 4_500 }], payment: { kind: 'PAID', method: 'DEBIT_CARD' } })
    ).json() as Venda;
    const antes = await saldo(oleo);

    const semMotivo = await post(`/api/v1/counter-sales/${venda.id}/cancel`, { reason: '' });
    expect(semMotivo.statusCode).toBe(400);

    const res = await post(`/api/v1/counter-sales/${venda.id}/cancel`, { reason: 'Cliente devolveu na hora' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('CANCELED');
    expect(await saldo(oleo)).toBe(antes + 2);

    const conta = (await get(`/api/v1/finance/entries/${venda.financialEntryId}`)).json();
    expect(conta.status).toBe('CANCELED');
    expect(conta.settlements[0].status).toBe('CANCELED');

    const deNovo = await post(`/api/v1/counter-sales/${venda.id}/cancel`, { reason: 'De novo' });
    expect(deNovo.statusCode).toBe(409);
    expect(await saldo(oleo), 'a segunda tentativa não devolve a peça de novo').toBe(antes + 2);
  });

  it('a conta da venda não se cancela pelo financeiro: tem que cancelar a venda', async () => {
    const venda = (
      await vender({
        customerId: cliente,
        items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }],
        payment: { kind: 'LATER', dueDate: '2099-12-10' },
      })
    ).json() as Venda;
    const res = await post(`/api/v1/finance/entries/${venda.financialEntryId}/cancel`, { reason: 'tentando pelo financeiro' });
    expect(res.statusCode).toBe(422);
  });

  it('atendente vende mas não cancela, e não dá desconto que o papel não permite', async () => {
    const venda = (
      await vender({ items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }], payment: { kind: 'PAID', method: 'PIX' } }, atendente)
    ).json() as Venda;
    const cancelar = await post(`/api/v1/counter-sales/${venda.id}/cancel`, { reason: 'Quero cancelar' }, atendente);
    expect(cancelar.statusCode).toBe(403);

    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    const vendaDoMecanico = await vender(
      { items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }], payment: { kind: 'PAID', method: 'PIX' } },
      mecanico,
    );
    expect(vendaDoMecanico.statusCode).toBe(403);
  });

  it('a venda entra no faturado e no recebido do painel, e no lucro com o custo da peça', async () => {
    const outra = await signup(t.app);
    const peca = (
      await createPart(t.app, outra, { name: 'Palheta', salePriceCents: 5_000, initialQuantity: 10, initialUnitCostCents: 2_000 })
    ).id;
    const vendida = await post(
      '/api/v1/counter-sales',
      { clientRequestId: randomUUID(), items: [{ partId: peca, quantity: 2, unitPriceCents: 5_000 }], payment: { kind: 'PAID', method: 'PIX' } },
      outra,
    );
    expect(vendida.statusCode, vendida.body).toBe(201);

    const painel = (await get('/api/v1/dashboard/summary?period=month', outra)).json();
    expect(painel.billedCents).toBe(10_000);
    expect(painel.receivedCents).toBe(10_000);

    const lucro = (await get('/api/v1/finance/profit?period=month', outra)).json();
    expect(lucro.receitaCents).toBe(10_000);
    expect(lucro.custoPecasCents, '2 palhetas a R$ 20 de custo').toBe(4_000);
    expect(lucro.lucroCents).toBe(6_000);

    // cancelada, sai das contas: a peça volta pelo mesmo custo
    await post(`/api/v1/counter-sales/${(vendida.json() as Venda).id}/cancel`, { reason: 'Desistiu' }, outra);
    const depois = (await get('/api/v1/finance/profit?period=month', outra)).json();
    expect(depois.receitaCents).toBe(0);
    expect(depois.custoPecasCents).toBe(0);
    const painelDepois = (await get('/api/v1/dashboard/summary?period=month', outra)).json();
    expect(painelDepois.billedCents).toBe(0);
    expect(painelDepois.receivedCents).toBe(0);
  });

  it('outra oficina não enxerga a venda', async () => {
    const venda = (
      await vender({ items: [{ partId: oleo, quantity: 1, unitPriceCents: 4_500 }], payment: { kind: 'PAID', method: 'PIX' } })
    ).json() as Venda;
    const estranha = await signup(t.app);
    expect((await get(`/api/v1/counter-sales/${venda.id}`, estranha)).statusCode).toBe(404);
    expect((await get('/api/v1/counter-sales', estranha)).json().data).toHaveLength(0);
  });
});
