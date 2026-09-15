import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface Pedido {
  id: string;
  number: number;
  status: string;
  version: number;
  closedShortAt: string | null;
  items: { id: string; partId: string; quantity: number; receivedQuantity: number; returnedQuantity: number; pendingQuantity: number }[];
  receipts: { items: { purchaseOrderItemId: string; quantity: number; unitCostCents: number; freightCents: number; landedUnitCostCents: number }[] }[];
  returns: { reason: string; items: { purchaseOrderItemId: string; quantity: number; unitCostCents: number }[] }[];
}
interface Peca {
  quantityOnHand: number;
  quantityReserved: number;
  averageCostCents: number | null;
  lastCostCents: number | null;
}
interface ItemOs {
  id: string;
  sourcing: string;
  stockStatus: string;
  reservedQuantity: number;
  approvalStatus: string;
}

/**
 * Recebimento e devolução (E12, Fase 3). É aqui que a compra encosta no estoque
 * e na OS, então cada número é conferido: saldo, custo médio com frete, reserva,
 * histórico de preço — e que receber duas vezes, ou devolver o que não chegou,
 * não acontece.
 */
describe('recebimento e devolução de compras', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let financeiro: TestSession;
  let fornecedor: string;
  let clienteId: string;
  let carroId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const peca = async (id: string) => (await get(`/api/v1/parts/${id}`)).json() as Peca;
  const primeiroErro = (body: string) => (JSON.parse(body) as { errors?: { message: string }[] }).errors?.[0]?.message;

  async function novaPeca(nome: string, extra: Record<string, unknown> = {}) {
    return (await createPart(t.app, dono, { name: nome, ...extra })).id;
  }

  /** Pedido já feito ao fornecedor, pronto para receber. */
  async function pedidoFeito(items: Record<string, unknown>[], shippingCents = 0) {
    const criado = await post('/api/v1/purchase-orders', { supplierId: fornecedor, shippingCents, items });
    expect(criado.statusCode, criado.body).toBe(201);
    const feito = await post(`/api/v1/purchase-orders/${criado.json().id}/order`, { version: criado.json().version });
    expect(feito.statusCode, feito.body).toBe(200);
    return feito.json().order as Pedido;
  }

  const receber = (pedido: Pedido, items: { purchaseOrderItemId: string; quantity: number; unitCostCents: number }[], extra: Record<string, unknown> = {}, s: TestSession = dono) =>
    post(`/api/v1/purchase-orders/${pedido.id}/receipts`, { clientRequestId: uuidv7(), items, ...extra }, s);

  const devolver = (pedido: Pedido, items: { purchaseOrderItemId: string; quantity: number }[], reason = 'Veio o modelo errado') =>
    post(`/api/v1/purchase-orders/${pedido.id}/returns`, { clientRequestId: uuidv7(), reason, items });

  async function itemDaOs(osNumero: number, itemId: string) {
    const os = (await get(`/api/v1/work-orders/${osNumero}`)).json() as { items: ItemOs[] };
    return os.items.find((i) => i.id === itemId)!;
  }

  /** OS com uma peça a comprar; aprovada pelo cliente quando pedido. */
  async function osComPeca(partId: string, quantidade: number, aprovar: boolean, sourcing = 'TO_ORDER') {
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId, quantity: quantidade, unitPriceCents: 32000, sourcing }],
    });
    if (aprovar) {
      const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`, {});
      expect(orcamento.statusCode, orcamento.body).toBe(201);
      const decisao = await post(`/api/v1/quotes/${orcamento.json().id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      expect(decisao.statusCode, decisao.body).toBe(200);
    }
    return { id: os.id, number: os.number, itemId: os.items[0]!.id };
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');
    const res = await post('/api/v1/suppliers', { name: 'Central Autopeças' });
    fornecedor = res.json().id;
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    clienteId = cliente.id;
    carroId = (await createVehicle(t.app, dono, cliente.id, { plate: 'REC1A23', make: 'Volkswagen', model: 'Gol' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ============================== o estoque ==================================

  it('dá entrada com o frete rateado no custo, recalcula o médio e grava o preço sem frete', async () => {
    // 4 discos a R$ 100 já na prateleira; pastilha sem estoque
    const disco = await novaPeca('Disco ventilado', { initialQuantity: 4, initialUnitCostCents: 10000 });
    const pastilha = await novaPeca('Pastilha cerâmica');
    const pedido = await pedidoFeito([
      { partId: disco, quantity: 2, unitCostCents: 19500 },
      { partId: pastilha, quantity: 1, unitCostCents: 8000 },
    ]);
    const [linhaDisco, linhaPastilha] = pedido.items;

    const res = await receber(
      pedido,
      [
        { purchaseOrderItemId: linhaDisco!.id, quantity: 2, unitCostCents: 19500 },
        { purchaseOrderItemId: linhaPastilha!.id, quantity: 1, unitCostCents: 8000 },
      ],
      { shippingCents: 1500, invoiceNumber: 'NF 4521' },
    );
    expect(res.statusCode, res.body).toBe(201);
    const recebido = res.json() as Pedido;
    expect(recebido.status).toBe('RECEIVED');
    expect(recebido.items.every((l) => l.pendingQuantity === 0)).toBe(true);

    // R$ 15 de frete por valor: R$ 390 e R$ 80 → 12,45 e 2,55 (maior resto leva o centavo)
    const itens = recebido.receipts[0]!.items;
    const doDisco = itens.find((i) => i.purchaseOrderItemId === linhaDisco!.id)!;
    const daPastilha = itens.find((i) => i.purchaseOrderItemId === linhaPastilha!.id)!;
    expect([doDisco.freightCents, daPastilha.freightCents]).toEqual([1245, 255]);
    // disco: R$ 195 + 12,45 / 2 = R$ 201,225 → R$ 201,23; pastilha: R$ 80 + 2,55
    expect(doDisco.landedUnitCostCents).toBe(20123);
    expect(daPastilha.landedUnitCostCents).toBe(8255);

    // 4 × R$ 100 + 2 × R$ 201,23 = R$ 802,46 / 6 = R$ 133,74
    expect(await peca(disco)).toMatchObject({ quantityOnHand: 6, averageCostCents: 13374, lastCostCents: 20123 });
    expect(await peca(pastilha)).toMatchObject({ quantityOnHand: 1, averageCostCents: 8255, lastCostCents: 8255 });

    const movimentos = (await get(`/api/v1/parts/${disco}/movements`)).json().data as { type: string; quantity: number; unitCostCents: number; balanceAfter: number }[];
    expect(movimentos.find((m) => m.type === 'PURCHASE_IN')).toMatchObject({ quantity: 2, unitCostCents: 20123, balanceAfter: 6 });

    const { db } = testDb();
    const historico = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ price_cents: string; source: string }>(
        sql`select price_cents, source from part_price_history where purchase_order_id = ${pedido.id} order by price_cents`,
      ),
    );
    expect(historico.rows.map((r) => [Number(r.price_cents), r.source])).toEqual([
      [8000, 'PURCHASE'],
      [19500, 'PURCHASE'],
    ]);

    // devolver os 2 discos pelo custo de entrada: o médio volta a R$ 100
    const devolucao = await devolver(recebido, [{ purchaseOrderItemId: linhaDisco!.id, quantity: 2 }]);
    expect(devolucao.statusCode, devolucao.body).toBe(201);
    const devolvido = devolucao.json() as Pedido;
    expect(devolvido.returns[0]).toMatchObject({ reason: 'Veio o modelo errado', items: [{ quantity: 2, unitCostCents: 20123 }] });
    expect(await peca(disco)).toMatchObject({ quantityOnHand: 4, averageCostCents: 10000 });
    const saida = ((await get(`/api/v1/parts/${disco}/movements`)).json().data as { type: string; quantity: number }[]).find((m) => m.type === 'SUPPLIER_RETURN');
    expect(saida?.quantity).toBe(-2);

    // o disco voltou a faltar: o pedido reabre, e a peça certa pode chegar
    expect(devolvido.status).toBe('PARTIAL');
    expect(devolvido.items.find((l) => l.id === linhaDisco!.id)!.pendingQuantity).toBe(2);
    const substituta = await receber(devolvido, [{ purchaseOrderItemId: linhaDisco!.id, quantity: 2, unitCostCents: 19000 }]);
    expect(substituta.statusCode, substituta.body).toBe(201);
    expect((substituta.json() as Pedido).status).toBe('RECEIVED');
    expect((await peca(disco)).quantityOnHand).toBe(6);
  });

  it('recebe em partes; mais do que falta é recusado', async () => {
    const pastilha = await novaPeca('Pastilha traseira');
    const pedido = await pedidoFeito([{ partId: pastilha, quantity: 4, unitCostCents: 5000 }]);
    const linha = pedido.items[0]!.id;

    const primeira = await receber(pedido, [{ purchaseOrderItemId: linha, quantity: 1, unitCostCents: 5000 }]);
    expect(primeira.statusCode, primeira.body).toBe(201);
    expect(primeira.json()).toMatchObject({ status: 'PARTIAL', items: [{ receivedQuantity: 1, pendingQuantity: 3 }] });

    const demais = await receber(pedido, [{ purchaseOrderItemId: linha, quantity: 4, unitCostCents: 5000 }]);
    expect(demais.statusCode, demais.body).toBe(400);
    expect(primeiroErro(demais.body)).toBe('Chegou mais do que falta: faltam 3 un');

    const resto = await receber(pedido, [{ purchaseOrderItemId: linha, quantity: 3, unitCostCents: 5200 }]);
    expect(resto.json()).toMatchObject({ status: 'RECEIVED', items: [{ receivedQuantity: 4, pendingQuantity: 0 }] });
    expect((await peca(pastilha)).quantityOnHand).toBe(4);
  });

  it('o mesmo envio não dá entrada duas vezes; a chave de outro pedido é recusada', async () => {
    const filtro = await novaPeca('Filtro de óleo');
    const pedido = await pedidoFeito([{ partId: filtro, quantity: 5, unitCostCents: 2000 }]);
    const envio = { clientRequestId: uuidv7(), items: [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 2, unitCostCents: 2000 }] };

    const primeiro = await post(`/api/v1/purchase-orders/${pedido.id}/receipts`, envio);
    const repetido = await post(`/api/v1/purchase-orders/${pedido.id}/receipts`, envio);
    expect(primeiro.statusCode, primeiro.body).toBe(201);
    expect(repetido.statusCode, repetido.body).toBe(201);
    expect((repetido.json() as Pedido).receipts).toHaveLength(1);
    expect((await peca(filtro)).quantityOnHand).toBe(2);

    const outro = await pedidoFeito([{ partId: filtro, quantity: 1, unitCostCents: 2000 }]);
    const comChaveAlheia = await post(`/api/v1/purchase-orders/${outro.id}/receipts`, {
      ...envio,
      items: [{ purchaseOrderItemId: outro.items[0]!.id, quantity: 1, unitCostCents: 2000 }],
    });
    expect(comChaveAlheia.statusCode, comChaveAlheia.body).toBe(409);
  });

  it('dois recebimentos ao mesmo tempo do que falta: um entra, o outro é recusado', async () => {
    const vela = await novaPeca('Vela de ignição');
    const pedido = await pedidoFeito([{ partId: vela, quantity: 4, unitCostCents: 3000 }]);
    const linha = pedido.items[0]!.id;
    // cada um sozinho caberia (3 de 4); juntos passariam do pedido. Sem a trava do
    // pedido, os dois leriam "recebido 0" e dariam entrada de 6
    const respostas = await Promise.all([
      receber(pedido, [{ purchaseOrderItemId: linha, quantity: 3, unitCostCents: 3000 }]),
      receber(pedido, [{ purchaseOrderItemId: linha, quantity: 3, unitCostCents: 3000 }]),
    ]);
    expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    expect(primeiroErro(respostas.find((r) => r.statusCode === 400)!.body)).toBe('Chegou mais do que falta: faltam 1 un');
    expect((await peca(vela)).quantityOnHand).toBe(3);
  });

  it('rascunho e cancelado não recebem; devolução só do que chegou', async () => {
    const correia = await novaPeca('Correia dentada');
    const rascunho = await post('/api/v1/purchase-orders', { supplierId: fornecedor, items: [{ partId: correia, quantity: 1, unitCostCents: 100 }] });
    const noRascunho = await receber(rascunho.json() as Pedido, [{ purchaseOrderItemId: rascunho.json().items[0].id, quantity: 1, unitCostCents: 100 }]);
    expect(noRascunho.statusCode, noRascunho.body).toBe(422);
    expect(noRascunho.json().detail).toBe('Não dá para receber um pedido em rascunho.');

    const feito = await pedidoFeito([{ partId: correia, quantity: 2, unitCostCents: 100 }]);
    const semNadaRecebido = await devolver(feito, [{ purchaseOrderItemId: feito.items[0]!.id, quantity: 1 }]);
    expect(semNadaRecebido.statusCode, semNadaRecebido.body).toBe(422);

    await receber(feito, [{ purchaseOrderItemId: feito.items[0]!.id, quantity: 1, unitCostCents: 100 }]);
    const demais = await devolver(feito, [{ purchaseOrderItemId: feito.items[0]!.id, quantity: 2 }]);
    expect(demais.statusCode, demais.body).toBe(400);
    expect(primeiroErro(demais.body)).toBe('Só dá para devolver 1 un');

    const cancelado = await pedidoFeito([{ partId: correia, quantity: 1, unitCostCents: 100 }]);
    await post(`/api/v1/purchase-orders/${cancelado.id}/cancel`, { reason: 'Não precisa mais' });
    expect((await receber(cancelado, [{ purchaseOrderItemId: cancelado.items[0]!.id, quantity: 1, unitCostCents: 100 }])).statusCode).toBe(422);
  });

  it('peça sem controle de estoque registra a chegada, sem movimento nem saldo', async () => {
    const graxa = await novaPeca('Graxa a granel', { trackStock: false });
    const pedido = await pedidoFeito([{ partId: graxa, quantity: 1, unitCostCents: 4500 }]);
    const res = await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1, unitCostCents: 4500 }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await peca(graxa)).toMatchObject({ quantityOnHand: 0, lastCostCents: 4500 });
    expect(((await get(`/api/v1/parts/${graxa}/movements`)).json().data as unknown[]).length).toBe(0);
  });

  it('encerrar o que falta com parte recebida de verdade; devolução depois não reabre', async () => {
    const amortecedor = await novaPeca('Amortecedor');
    const pedido = await pedidoFeito([{ partId: amortecedor, quantity: 4, unitCostCents: 25000 }]);
    const linha = pedido.items[0]!.id;
    await receber(pedido, [{ purchaseOrderItemId: linha, quantity: 2, unitCostCents: 25000 }]);
    const encerrado = await post(`/api/v1/purchase-orders/${pedido.id}/close`, { reason: 'Fornecedor sem o resto' });
    expect(encerrado.json()).toMatchObject({ status: 'RECEIVED' });
    const devolucao = await devolver(encerrado.json() as Pedido, [{ purchaseOrderItemId: linha, quantity: 1 }]);
    expect(devolucao.statusCode, devolucao.body).toBe(201);
    expect((devolucao.json() as Pedido).status).toBe('RECEIVED');
    expect((await peca(amortecedor)).quantityOnHand).toBe(1);
  });

  // =============================== a OS ======================================

  it('peça de OS aprovada chega reservada para ela, avisa a equipe e sai na finalização', async () => {
    // 3 em estoque, todas prometidas a outra OS: a compra é que precisa ficar com esta
    const bomba = await novaPeca("Bomba d'água", { initialQuantity: 3, initialUnitCostCents: 15000 });
    // a outra OS pegou as 3 do estoque: aprovada com a peça "do estoque", reservou na aprovação
    const outra = await osComPeca(bomba, 3, true, 'STOCK');
    expect(await itemDaOs(outra.number, outra.itemId)).toMatchObject({ stockStatus: 'RESERVED', reservedQuantity: 3 });
    expect((await peca(bomba)).quantityReserved).toBe(3);

    const os = await osComPeca(bomba, 2, true);
    const pedido = await pedidoFeito([{ partId: bomba, quantity: 2, unitCostCents: 16000, workOrderItemId: os.itemId }]);
    const res = await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 2, unitCostCents: 16000 }]);
    expect(res.statusCode, res.body).toBe(201);

    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ sourcing: 'STOCK', stockStatus: 'RESERVED', reservedQuantity: 2 });
    expect(await peca(bomba)).toMatchObject({ quantityOnHand: 5, quantityReserved: 5 });

    const timeline = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string; data: { text?: string } }[];
    expect(timeline.find((e) => e.type === 'PURCHASE_RECEIVED')?.data.text).toContain('reservada para esta OS');
    // quem cuida da OS é avisado; quem recebeu não precisa de aviso do que fez
    const sinoAtendente = (await get('/api/v1/notifications', atendente)).json() as { data: { type: string; title: string }[] };
    expect(sinoAtendente.data.some((n) => n.type === 'PURCHASE_RECEIVED' && n.title === `Peça chegou — OS ${os.number}`)).toBe(true);
    const sinoDono = (await get('/api/v1/notifications')).json() as { data: { type: string }[] };
    expect(sinoDono.data.some((n) => n.type === 'PURCHASE_RECEIVED')).toBe(false);

    // a cadeia fecha: finalizar a OS tira as 2 do estoque
    expect((await post(`/api/v1/work-orders/${os.id}/start`, {})).statusCode).toBe(200);
    const fim = await post(`/api/v1/work-orders/${os.id}/complete`, {});
    expect(fim.statusCode, fim.body).toBe(200);
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ stockStatus: 'CONSUMED' });
    expect(await peca(bomba)).toMatchObject({ quantityOnHand: 3, quantityReserved: 3 });
  });

  it('chegou só parte da peça da OS: reserva o que chegou', async () => {
    const radiador = await novaPeca('Radiador');
    const os = await osComPeca(radiador, 2, true);
    const pedido = await pedidoFeito([{ partId: radiador, quantity: 2, unitCostCents: 40000, workOrderItemId: os.itemId }]);
    await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1, unitCostCents: 40000 }]);
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ stockStatus: 'PARTIAL', reservedQuantity: 1 });
  });

  it('peça de OS ainda em rascunho vira "do estoque" e reserva quando o cliente aprovar', async () => {
    const sensor = await novaPeca('Sensor de rotação');
    const os = await osComPeca(sensor, 1, false);
    const pedido = await pedidoFeito([{ partId: sensor, quantity: 1, unitCostCents: 12000, workOrderItemId: os.itemId }]);
    await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1, unitCostCents: 12000 }]);

    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ sourcing: 'STOCK', stockStatus: 'NONE', reservedQuantity: 0 });
    expect((await peca(sensor)).quantityReserved).toBe(0);
    const timeline = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string; data: { text?: string } }[];
    expect(timeline.find((e) => e.type === 'PURCHASE_RECEIVED')?.data.text).toContain('a reserva acontece quando o orçamento for aprovado');

    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`, {});
    await post(`/api/v1/quotes/${orcamento.json().id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ stockStatus: 'RESERVED', reservedQuantity: 1 });
  });

  it('estoque negativo antes da chegada: a compra cobre o buraco e só reserva o que sobra', async () => {
    const junta = await novaPeca('Junta do cabeçote');
    // uma OS usou 1 junta que não estava no estoque: o saldo ficou em −1 (E7)
    const usou = await osComPeca(junta, 1, true, 'STOCK');
    expect((await post(`/api/v1/work-orders/${usou.id}/start`, {})).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${usou.id}/complete`, {})).statusCode).toBe(200);
    expect((await peca(junta)).quantityOnHand).toBe(-1);

    const os = await osComPeca(junta, 2, true);
    const pedido = await pedidoFeito([{ partId: junta, quantity: 2, unitCostCents: 7000, workOrderItemId: os.itemId }]);
    await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 2, unitCostCents: 7000 }]);
    // chegaram 2, uma tapa o −1: sobra 1 para reservar, e nunca se reserva mais do que existe
    expect(await peca(junta)).toMatchObject({ quantityOnHand: 1, quantityReserved: 1 });
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ stockStatus: 'PARTIAL', reservedQuantity: 1 });
  });

  it('OS cancelada antes da peça chegar: a compra fica no estoque, sem reserva nem aviso', async () => {
    const turbina = await novaPeca('Turbina');
    const os = await osComPeca(turbina, 1, true);
    const pedido = await pedidoFeito([{ partId: turbina, quantity: 1, unitCostCents: 150000, workOrderItemId: os.itemId }]);
    expect((await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' })).statusCode).toBe(200);

    const res = await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1, unitCostCents: 150000 }]);
    expect(res.statusCode, res.body).toBe(201);
    expect(await peca(turbina)).toMatchObject({ quantityOnHand: 1, quantityReserved: 0 });
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ reservedQuantity: 0 });
    const timeline = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string }[];
    expect(timeline.some((e) => e.type === 'PURCHASE_RECEIVED')).toBe(false);
  });

  it('devolver a peça de uma OS desfaz a reserva e avisa que ela volta a faltar', async () => {
    const coxim = await novaPeca('Coxim do motor');
    const os = await osComPeca(coxim, 2, true);
    const pedido = await pedidoFeito([{ partId: coxim, quantity: 2, unitCostCents: 9000, workOrderItemId: os.itemId }]);
    const recebido = (await receber(pedido, [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 2, unitCostCents: 9000 }])).json() as Pedido;
    expect((await peca(coxim)).quantityReserved).toBe(2);

    const res = await devolver(recebido, [{ purchaseOrderItemId: recebido.items[0]!.id, quantity: 1 }], 'Um veio com defeito');
    expect(res.statusCode, res.body).toBe(201);
    expect(await itemDaOs(os.number, os.itemId)).toMatchObject({ stockStatus: 'PARTIAL', reservedQuantity: 1 });
    expect(await peca(coxim)).toMatchObject({ quantityOnHand: 1, quantityReserved: 1 });
    const timeline = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json().data as { type: string; data: { text?: string } }[];
    expect(timeline.some((e) => e.type === 'NOTE' && e.data.text?.includes('Motivo: Um veio com defeito. A peça volta a faltar'))).toBe(true);
  });

  // ============================ permissão e isolamento =======================

  it('financeiro não recebe nem devolve; oficina de fora recebe 404', async () => {
    const oleo = await novaPeca('Óleo 5W30');
    const pedido = await pedidoFeito([{ partId: oleo, quantity: 1, unitCostCents: 3000 }]);
    const itens = [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1, unitCostCents: 3000 }];
    expect((await receber(pedido, itens, {}, financeiro)).statusCode).toBe(403);
    expect((await receber(pedido, itens, {}, atendente)).statusCode).toBe(403);
    const vizinha = await signup(t.app);
    expect((await receber(pedido, itens, {}, vizinha)).statusCode).toBe(404);
    expect(
      (await post(`/api/v1/purchase-orders/${pedido.id}/returns`, { clientRequestId: uuidv7(), reason: 'Não é meu', items: [{ purchaseOrderItemId: pedido.items[0]!.id, quantity: 1 }] }, vizinha))
        .statusCode,
    ).toBe(404);
    expect((await peca(oleo)).quantityOnHand).toBe(0);
  });
});
