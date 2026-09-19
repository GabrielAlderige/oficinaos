import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface TestPart {
  id: string;
  quantityOnHand: number;
  quantityReserved: number;
  quantityAvailable: number;
  averageCostCents: number;
  stockStatus: string;
}

/**
 * Execução e baixa de estoque (ARCHITECTURE §10). A regra que mais importa aqui
 * é a que parece errada e não é: faltar peça **não** trava a finalização.
 */
describe('execução e baixa de estoque', () => {
  let t: TestApp;
  let owner: TestSession;
  let serviceId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
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
    return `EXE${placas % 10}A${String(placas % 100).padStart(2, '0')}`;
  }

  const peca = async (id: string): Promise<TestPart> => (await get(`/api/v1/parts/${id}`)).json() as TestPart;
  const itemDePeca = async (number: number) => {
    const os = (await get(`/api/v1/work-orders/${number}`)).json();
    return (os.items as { type: string; stockStatus: string }[]).find((item) => item.type === 'PART');
  };

  /** OS já aprovada (com a peça reservada), pronta para executar. */
  async function osAprovada(options: { estoque: number; quantidade: number }) {
    const part = await createPart(t.app, owner, {
      name: 'Pastilha de freio',
      salePriceCents: 25000,
      initialQuantity: options.estoque,
      initialUnitCostCents: 10000,
    });
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [
        { type: 'SERVICE', serviceId },
        { type: 'PART', partId: part.id, quantity: options.quantidade },
      ],
    });

    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    const decisao = await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect(decisao.statusCode, decisao.body).toBe(200);
    return { part, order, quoteId: quote.id };
  }

  it('finalizar tira a peça do estoque e consome a reserva', async () => {
    const { part, order } = await osAprovada({ estoque: 4, quantidade: 2 });

    const reservada = await peca(part.id);
    expect(reservada.quantityOnHand).toBe(4);
    expect(reservada.quantityReserved, 'aprovar reserva, não baixa').toBe(2);

    expect((await post(`/api/v1/work-orders/${order.id}/start`)).statusCode).toBe(200);
    const finalizou = await post(`/api/v1/work-orders/${order.id}/complete`);
    expect(finalizou.statusCode, finalizou.body).toBe(200);
    expect(finalizou.json().status).toBe('COMPLETED');

    const depois = await peca(part.id);
    expect(depois.quantityOnHand, 'saiu do estoque de verdade').toBe(2);
    expect(depois.quantityReserved, 'a reserva virou saída').toBe(0);
    expect(depois.quantityAvailable).toBe(2);
    expect((await itemDePeca(order.number))?.stockStatus).toBe('CONSUMED');
  });

  it('estoque insuficiente não trava a finalização: o saldo fica negativo', async () => {
    // a oficina montou 3 tendo 1 no sistema. Travar aqui faria o dono entregar
    // o carro por fora do sistema — o saldo negativo é o alerta, não a trava.
    const { part, order } = await osAprovada({ estoque: 1, quantidade: 3 });
    await post(`/api/v1/work-orders/${order.id}/start`);

    const finalizou = await post(`/api/v1/work-orders/${order.id}/complete`);
    expect(finalizou.statusCode, finalizou.body).toBe(200);

    const depois = await peca(part.id);
    expect(depois.quantityOnHand).toBe(-2);
    expect(depois.quantityReserved).toBe(0);
    expect(depois.stockStatus, 'a peça entra na lista de acerto de contagem').toBe('NEGATIVE');
  });

  it('tirar a peça da OS reaberta devolve ela ao estoque, com movimento próprio', async () => {
    const { part, order, quoteId } = await osAprovada({ estoque: 4, quantidade: 2 });
    await post(`/api/v1/work-orders/${order.id}/start`);
    await post(`/api/v1/work-orders/${order.id}/complete`);
    expect((await peca(part.id)).quantityOnHand, 'saiu na finalização').toBe(2);

    expect((await post(`/api/v1/work-orders/${order.id}/reopen`)).statusCode).toBe(200);
    const item = (await itemDePeca(order.number)) as { id: string } | undefined;
    const removeu = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/work-orders/${order.id}/items/${item!.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(removeu.statusCode, removeu.body).toBe(200);

    const depois = await peca(part.id);
    expect(depois.quantityOnHand, 'a peça não foi para o carro: voltou para a prateleira').toBe(4);
    // o custo médio volta ao que era: ela retorna pelo custo com que saiu
    expect(depois.averageCostCents).toBe(10_000);

    const movimentos = await get(`/api/v1/parts/${part.id}/movements`);
    expect(movimentos.statusCode, movimentos.body).toBe(200);
    const tipos = (movimentos.json() as { data: { type: string; quantity: number }[] }).data;
    const devolucao = tipos.find((movimento) => movimento.type === 'CUSTOMER_RETURN');
    expect(devolucao, 'a devolução tem movimento próprio, não é ajuste').toBeTruthy();
    expect(devolucao!.quantity).toBe(2);

    // e aparece na timeline, para a oficina saber por que o saldo mudou
    const timeline = await get(`/api/v1/work-orders/${order.id}/timeline`);
    expect((timeline.json() as { data: { type: string }[] }).data.some((e) => e.type === 'PART_RETURNED')).toBe(true);

    // o orçamento aprovado é prova do que o cliente viu: continua com a peça
    const orcamento = await get(`/api/v1/quotes/${quoteId}`);
    expect(orcamento.statusCode, orcamento.body).toBe(200);
    const itensDoOrcamento = (orcamento.json() as { items: { description: string }[] }).items;
    expect(itensDoOrcamento.some((linha) => linha.description.includes('Pastilha'))).toBe(true);
  });

  it('reduzir a quantidade de uma peça já baixada devolve só a diferença', async () => {
    const { part, order } = await osAprovada({ estoque: 5, quantidade: 3 });
    await post(`/api/v1/work-orders/${order.id}/start`);
    await post(`/api/v1/work-orders/${order.id}/complete`);
    expect((await peca(part.id)).quantityOnHand).toBe(2);

    await post(`/api/v1/work-orders/${order.id}/reopen`);
    const item = (await itemDePeca(order.number)) as { id: string } | undefined;
    const alterou = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${order.id}/items/${item!.id}`,
      headers: bearer(owner.accessToken),
      payload: { quantity: 1 },
    });
    expect(alterou.statusCode, alterou.body).toBe(200);

    // usou 1 das 3 que tinham saído: duas voltam
    expect((await peca(part.id)).quantityOnHand).toBe(4);

    // e mexer em outra coisa depois não devolve nada de novo
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${order.id}/items/${item!.id}`,
      headers: bearer(owner.accessToken),
      payload: { unitPriceCents: 27_000 },
    });
    expect((await peca(part.id)).quantityOnHand).toBe(4);

    // aumentar de novo não tira do estoque (a baixa é na finalização), então
    // tirar o item devolve só a que ainda está fora: 1, não 4
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/work-orders/${order.id}/items/${item!.id}`,
      headers: bearer(owner.accessToken),
      payload: { quantity: 4 },
    });
    expect((await peca(part.id)).quantityOnHand, 'aumentar não mexe no saldo').toBe(4);

    const removeu = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/work-orders/${order.id}/items/${item!.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(removeu.statusCode, removeu.body).toBe(200);
    expect((await peca(part.id)).quantityOnHand, 'não inventa peça que nunca saiu').toBe(5);
  });

  it('reabrir e finalizar de novo não baixa a peça duas vezes', async () => {
    const { part, order } = await osAprovada({ estoque: 4, quantidade: 2 });
    await post(`/api/v1/work-orders/${order.id}/start`);
    await post(`/api/v1/work-orders/${order.id}/complete`);
    expect((await peca(part.id)).quantityOnHand).toBe(2);

    expect((await post(`/api/v1/work-orders/${order.id}/reopen`)).statusCode).toBe(200);
    const denovo = await post(`/api/v1/work-orders/${order.id}/complete`);
    expect(denovo.statusCode, denovo.body).toBe(200);

    expect((await peca(part.id)).quantityOnHand, 'a peça já tinha saído na primeira vez').toBe(2);
    expect((await itemDePeca(order.number))?.stockStatus).toBe('CONSUMED');
  });

  it('só o que foi aprovado sai do estoque: peça lançada depois fica de fora', async () => {
    const { part, order } = await osAprovada({ estoque: 4, quantidade: 2 });

    // o mecânico achou outro problema no meio do serviço e lançou a peça na OS.
    // Ela ainda não foi aprovada pelo cliente: não pode sair do estoque junto.
    const extra = await createPart(t.app, owner, {
      name: 'Disco de freio',
      salePriceCents: 30000,
      initialQuantity: 5,
      initialUnitCostCents: 12000,
    });
    const adicionou = await post(`/api/v1/work-orders/${order.id}/items`, {
      type: 'PART',
      partId: extra.id,
      quantity: 1,
    });
    expect(adicionou.statusCode, adicionou.body).toBe(201);

    await post(`/api/v1/work-orders/${order.id}/start`);
    expect((await post(`/api/v1/work-orders/${order.id}/complete`)).statusCode).toBe(200);

    expect((await peca(part.id)).quantityOnHand, 'o item aprovado saiu').toBe(2);
    expect((await peca(extra.id)).quantityOnHand, 'o item em rascunho não saiu').toBe(5);
  });

  it('avisa o cliente que o veículo está pronto, com o saldo em aberto', async () => {
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira', whatsapp: '(11) 91234-5678' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    expect((await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' })).statusCode).toBe(200);

    const res = await post(`/api/v1/work-orders/${order.id}/vehicle-ready`);
    expect(res.statusCode, res.body).toBe(200);
    const { message, whatsappUrl } = res.json() as { message: string; whatsappUrl: string };

    expect(message).toContain('João');
    expect(message).toContain('pronto para retirada');
    expect(message, 'o saldo faz o cliente chegar com o valor certo').toContain('180,00');

    // o telefone é gravado em E.164 (+5511912345678). O wa.me quer só dígitos:
    // concatenar "55" no valor gravado gerava `wa.me/55+55…`, link que não abre
    expect(whatsappUrl).toContain('https://wa.me/5511912345678?text=');
    expect(whatsappUrl).not.toContain('+');
    expect(whatsappUrl).not.toContain('wa.me/5555');

    // e fica na timeline do carro: a oficina precisa saber se já avisaram
    const timeline = (await get(`/api/v1/work-orders/${order.id}/timeline`)).json().data as { type: string }[];
    expect(timeline.some((evento) => evento.type === 'CUSTOMER_NOTIFIED')).toBe(true);
  });

  it('peça do cliente e peça a comprar não saem do estoque da oficina', async () => {
    // o cliente trouxe uma peça, e outra ainda será comprada. Nenhuma das duas
    // é da prateleira da oficina, então finalizar não pode mexer no saldo (§10)
    const doCliente = await createPart(t.app, owner, {
      name: 'Amortecedor trazido pelo cliente',
      salePriceCents: 40000,
      initialQuantity: 5,
      initialUnitCostCents: 20000,
    });
    const aComprar = await createPart(t.app, owner, {
      name: 'Correia dentada',
      salePriceCents: 15000,
      initialQuantity: 3,
      initialUnitCostCents: 7000,
    });
    const customer = await createCustomer(t.app, owner, { name: 'João Pereira' });
    const vehicle = await createVehicle(t.app, owner, customer.id, { plate: nextPlate() });
    const order = await createWorkOrder(t.app, owner, {
      customerId: customer.id,
      vehicleId: vehicle.id,
      items: [
        { type: 'SERVICE', serviceId },
        { type: 'PART', partId: doCliente.id, quantity: 1, sourcing: 'CUSTOMER_PROVIDED' },
        { type: 'PART', partId: aComprar.id, quantity: 1, sourcing: 'TO_ORDER' },
      ],
    });

    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    const decisao = await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect(decisao.statusCode, decisao.body).toBe(200);

    // aprovar também não pode prender essas peças: a reserva ignora origem
    // que não seja da prateleira
    expect((await peca(doCliente.id)).quantityReserved, 'peça do cliente não se reserva').toBe(0);
    expect((await peca(aComprar.id)).quantityReserved, 'peça a comprar não se reserva').toBe(0);

    await post(`/api/v1/work-orders/${order.id}/start`);
    expect((await post(`/api/v1/work-orders/${order.id}/complete`)).statusCode).toBe(200);

    expect((await peca(doCliente.id)).quantityOnHand, 'a peça é do cliente').toBe(5);
    expect((await peca(aComprar.id)).quantityOnHand, 'a peça ainda será comprada').toBe(3);
  });
});
