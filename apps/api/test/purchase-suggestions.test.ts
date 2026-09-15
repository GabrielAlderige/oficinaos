import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface Sugestao {
  kind: string;
  partId: string;
  partName: string;
  quantity: number;
  unitCostCents: number | null;
  workOrderItemId: string | null;
  workOrderNumber: number | null;
  reason: string;
}
interface Grupos {
  groups: { supplier: { id: string; name: string } | null; items: Sugestao[] }[];
}

/**
 * Sugestão de compra e históricos (E12, Fase 5). A sugestão tem de acertar a
 * conta (mínimo, reservado, o que já vem) e não repetir o que já foi pedido; os
 * históricos, não mostrar custo para quem não vê custo.
 */
describe('sugestão de compra e históricos', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let financeiro: TestSession;
  let central: string;
  let paulista: string;
  let clienteId: string;
  let carroId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const sugestoes = async () => {
    const res = await get('/api/v1/purchase-orders/suggestions');
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Grupos;
  };
  const todas = (g: Grupos) => g.groups.flatMap((grupo) => grupo.items.map((item) => ({ ...item, fornecedor: grupo.supplier?.name ?? null })));

  async function fornecedor(nome: string) {
    return (await post('/api/v1/suppliers', { name: nome })).json().id as string;
  }

  async function aprovar(osId: string) {
    const orcamento = await post(`/api/v1/work-orders/${osId}/quotes`, {});
    expect(orcamento.statusCode, orcamento.body).toBe(201);
    expect((await post(`/api/v1/quotes/${orcamento.json().id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' })).statusCode).toBe(200);
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');
    central = await fornecedor('Central Autopeças');
    paulista = await fornecedor('Distribuidora Paulista');
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    clienteId = cliente.id;
    carroId = (await createVehicle(t.app, dono, cliente.id, { plate: 'SUG1A23' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // =============================== sugestão ==================================

  it('repõe o mínimo descontando reservado e o que já vem; agrupa pelo preferido', async () => {
    const filtro = (
      await createPart(t.app, dono, { name: 'Filtro de óleo', minQuantity: 4, initialQuantity: 1, initialUnitCostCents: 2500, preferredSupplierId: central })
    ).id;
    await createPart(t.app, dono, { name: 'Vela com folga', minQuantity: 2, initialQuantity: 5, initialUnitCostCents: 3000 });
    await createPart(t.app, dono, { name: 'Peça sem mínimo', minQuantity: 0 });
    const correia = (await createPart(t.app, dono, { name: 'Correia auxiliar', minQuantity: 3 })).id;

    // 2 correias já pedidas (sem OS): faltam só 1 para o mínimo
    const pedido = await post('/api/v1/purchase-orders', { supplierId: paulista, items: [{ partId: correia, quantity: 2, unitCostCents: 4000 }] });
    await post(`/api/v1/purchase-orders/${pedido.json().id}/order`, { version: pedido.json().version });

    // pedido de filtro cancelado não vem mais: não pode descontar da reposição
    const cancelado = await post('/api/v1/purchase-orders', { supplierId: central, items: [{ partId: filtro, quantity: 3, unitCostCents: 2500 }] });
    expect((await post(`/api/v1/purchase-orders/${cancelado.json().id}/cancel`, { reason: 'Desisti' })).statusCode).toBe(200);

    const lista = todas(await sugestoes());
    expect(lista.find((i) => i.partId === filtro)).toMatchObject({
      kind: 'RESTOCK',
      quantity: 3,
      unitCostCents: 2500,
      fornecedor: 'Central Autopeças',
      reason: 'abaixo do mínimo: disponível 1 un de 4 un',
    });
    expect(lista.find((i) => i.partId === correia)).toMatchObject({
      quantity: 1,
      fornecedor: null,
      reason: 'abaixo do mínimo: disponível 0 un de 3 un, 2 un já pedida(s)',
    });
    expect(lista.some((i) => i.partName === 'Vela com folga' || i.partName === 'Peça sem mínimo')).toBe(false);

    // fornecedor com nome primeiro; "sem preferido" por último
    const grupos = (await sugestoes()).groups;
    expect(grupos.at(-1)!.supplier).toBeNull();
  });

  it('peça que a OS espera entra; pedida, sai; pedido cancelado, volta', async () => {
    const pastilha = (await createPart(t.app, dono, { name: 'Pastilha dianteira', preferredSupplierId: paulista })).id;
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: pastilha, quantity: 2, unitPriceCents: 9000, sourcing: 'TO_ORDER' }],
    });
    const itemId = os.items[0]!.id;
    const acha = async () => todas(await sugestoes()).find((i) => i.workOrderItemId === itemId);

    expect(await acha()).toMatchObject({
      kind: 'WORK_ORDER',
      quantity: 2,
      workOrderNumber: os.number,
      fornecedor: 'Distribuidora Paulista',
      reason: `OS ${os.number}: marcada "Comprar", orçamento ainda sem aprovação`,
    });

    const pedido = await post('/api/v1/purchase-orders', {
      supplierId: paulista,
      items: [{ partId: pastilha, quantity: 2, unitCostCents: 4200, workOrderItemId: itemId }],
    });
    expect(pedido.statusCode, pedido.body).toBe(201);
    expect(await acha()).toBeUndefined();

    expect((await post(`/api/v1/purchase-orders/${pedido.json().id}/cancel`, { reason: 'Troquei de ideia' })).statusCode).toBe(200);
    expect((await acha())?.quantity).toBe(2);
  });

  it('peça "do estoque" aprovada que não conseguiu reserva inteira entra pelo que faltou', async () => {
    const amortecedor = (await createPart(t.app, dono, { name: 'Amortecedor', initialQuantity: 1, initialUnitCostCents: 20000 })).id;
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: amortecedor, quantity: 3, unitPriceCents: 35000 }],
    });
    await aprovar(os.id);
    const item = todas(await sugestoes()).find((i) => i.workOrderItemId === os.items[0]!.id);
    // 3 pedidas pelo cliente, 1 reservada do estoque: faltam 2
    expect(item).toMatchObject({ quantity: 2, reason: `OS ${os.number}: faltou no estoque` });
  });

  it('OS cancelada e item recusado não entram', async () => {
    const turbina = (await createPart(t.app, dono, { name: 'Turbina' })).id;
    const cancelada = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: turbina, quantity: 1, unitPriceCents: 1000, sourcing: 'TO_ORDER' }],
    });
    await post(`/api/v1/work-orders/${cancelada.id}/cancel`, { reason: 'Cliente desistiu' });

    const recusada = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: turbina, quantity: 1, unitPriceCents: 1000, sourcing: 'TO_ORDER' }],
    });
    const orcamento = await post(`/api/v1/work-orders/${recusada.id}/quotes`, {});
    await post(`/api/v1/quotes/${orcamento.json().id}/manual-decision`, { decision: 'REJECTED', channel: 'PHONE' });

    expect(todas(await sugestoes()).some((i) => i.partId === turbina)).toBe(false);
  });

  it('financeiro vê a sugestão; atendente não', async () => {
    expect((await get('/api/v1/purchase-orders/suggestions', financeiro)).statusCode).toBe(200);
    expect((await get('/api/v1/purchase-orders/suggestions', atendente)).statusCode).toBe(403);
  });

  // =============================== históricos ================================

  describe('históricos do fornecedor e da peça', () => {
    let disco: string;
    let cotacaoNumero: number;
    let pedidoNumero: number;

    beforeAll(async () => {
      disco = (await createPart(t.app, dono, { name: 'Disco de freio' })).id;
      const os = await createWorkOrder(t.app, dono, {
        customerId: clienteId,
        vehicleId: carroId,
        items: [{ type: 'PART', partId: disco, quantity: 2, unitPriceCents: 32000, sourcing: 'TO_ORDER' }],
      });
      const criada = await post('/api/v1/supplier-quotes', { workOrderId: os.id, workOrderItemIds: [os.items[0]!.id], supplierIds: [central, paulista] });
      const { quote, links } = criada.json() as { quote: { id: string; number: number }; links: { supplierId: string; link: string }[] };
      cotacaoNumero = quote.number;
      // só a Paulista responde
      const token = links.find((l) => l.supplierId === paulista)!.link.split('/').pop()!;
      const tela = (await t.app.inject({ method: 'GET', url: `/api/v1/public/supplier-quotes/${token}`, remoteAddress: nextIp() })).json();
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/public/supplier-quotes/${token}/responses`,
        remoteAddress: nextIp(),
        payload: {
          contentHash: tela.contentHash,
          responderName: 'Márcia',
          items: [{ requestItemId: tela.items[0].id, availability: 'AVAILABLE', unitPriceCents: 18900 }],
        },
      });
      const quadro = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json();
      const oferta = quadro.invites.find((c: { supplier: { id: string } }) => c.supplier.id === paulista).response.items[0];
      await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: oferta.requestItemId, responseItemId: oferta.id }] });

      const gerado = (await post('/api/v1/purchase-orders/from-quote', { supplierQuoteRequestId: quote.id })).json();
      const pedido = gerado.orders[0];
      pedidoNumero = pedido.number;
      const feito = await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: pedido.version });
      await post(`/api/v1/purchase-orders/${pedido.id}/receipts`, {
        clientRequestId: uuidv7(),
        items: [{ purchaseOrderItemId: feito.json().order.items[0].id, quantity: 2, unitCostCents: 18500 }],
      });
    });

    it('o fornecedor mostra as cotações (respondeu ou não) e os pedidos', async () => {
      const daPaulista = (await get(`/api/v1/suppliers/${paulista}/history`)).json();
      expect(daPaulista.quotes.find((q: { number: number }) => q.number === cotacaoNumero)).toMatchObject({ answered: true, status: 'CLOSED' });
      expect(daPaulista.purchases.find((p: { number: number }) => p.number === pedidoNumero)).toMatchObject({ status: 'RECEIVED', totalCents: 37800, itemCount: 1 });

      const daCentral = (await get(`/api/v1/suppliers/${central}/history`)).json();
      expect(daCentral.quotes.find((q: { number: number }) => q.number === cotacaoNumero)).toMatchObject({ answered: false });
    });

    it('atendente vê as cotações do fornecedor, mas não as compras', async () => {
      const res = await get(`/api/v1/suppliers/${paulista}/history`, atendente);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().quotes.length).toBeGreaterThan(0);
      expect(res.json().purchases).toBeNull();
      expect(res.body).not.toContain('37800');
    });

    it('a peça mostra o preço cotado e o pago, do mais recente para o mais antigo', async () => {
      const res = await get(`/api/v1/parts/${disco}/price-history`);
      expect(res.statusCode, res.body).toBe(200);
      const linhas = res.json().data as { priceCents: number; source: string; supplier: { name: string }; purchaseOrder: { number: number } | null; supplierQuote: { number: number } | null }[];
      expect(linhas.map((l) => [l.source, l.priceCents])).toEqual([
        ['PURCHASE', 18500],
        ['RFQ', 18900],
      ]);
      expect(linhas[0]).toMatchObject({ supplier: { name: 'Distribuidora Paulista' }, purchaseOrder: { number: pedidoNumero }, supplierQuote: null });
      expect(linhas[1]).toMatchObject({ purchaseOrder: null, supplierQuote: { number: cotacaoNumero } });
    });

    it('histórico de preço é custo: atendente não vê; oficina de fora recebe 404', async () => {
      expect((await get(`/api/v1/parts/${disco}/price-history`, atendente)).statusCode).toBe(403);
      const vizinha = await signup(t.app);
      expect((await get(`/api/v1/parts/${disco}/price-history`, vizinha)).statusCode).toBe(404);
      expect((await get(`/api/v1/suppliers/${paulista}/history`, vizinha)).statusCode).toBe(404);
    });
  });
});
