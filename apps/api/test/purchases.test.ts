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

interface Linha {
  id: string;
  partId: string;
  description: string;
  partCode: string | null;
  quantity: number;
  unitCostCents: number;
  lineTotalCents: number;
  workOrder: { id: string; number: number; itemId: string; vehicleLabel: string } | null;
  supplierQuoteAwardId: string | null;
}
interface Pedido {
  id: string;
  number: number;
  status: string;
  version: number;
  supplier: { id: string; name: string; removed: boolean };
  supplierQuote: { id: string; number: number } | null;
  shippingCents: number;
  itemsTotalCents: number;
  totalCents: number;
  orderedAt: string | null;
  orderedBy: { name: string } | null;
  canceledAt: string | null;
  cancelReason: string | null;
  closedShortAt: string | null;
  items: Linha[];
}

/**
 * Pedidos de compra (E12, Fase 2). O que precisa ficar provado: a linha sai do
 * cadastro da peça; a peça de uma OS não é comprada duas vezes; a escolha da
 * cotação vira um pedido só e não se troca depois; fora do rascunho nada muda;
 * e compra é coisa de gerente para cima.
 */
describe('pedidos de compra', () => {
  let t: TestApp;
  let dono: TestSession;
  let gerente: TestSession;
  let financeiro: TestSession;
  let atendente: TestSession;
  let central: string;
  let paulista: string;
  let disco: string;
  let pastilha: string;
  let osId: string;
  let osNumero: number;
  let itemDisco: string;
  let itemDoCliente: string;
  let itemServico: string;
  let clienteId: string;
  let carroId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  async function criarPedido(payload: Record<string, unknown>, s: TestSession = dono) {
    const res = await post('/api/v1/purchase-orders', payload, s);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Pedido;
  }

  async function fornecedor(nome: string, s: TestSession = dono, extra: Record<string, unknown> = {}) {
    const res = await post('/api/v1/suppliers', { name: nome, ...extra }, s);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  const primeiroErro = (body: string) => (JSON.parse(body) as { errors?: { message: string }[] }).errors?.[0]?.message;

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    gerente = await addMember(t.app, dono, 'MANAGER', 'Gil Gerente');
    financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    central = await fornecedor('Central Autopeças', dono, { whatsapp: '(11) 98888-7777', contactName: 'Roberto Silva' });
    paulista = await fornecedor('Distribuidora Paulista');
    disco = (await createPart(t.app, dono, { name: 'Disco de freio ventilado', manufacturerCode: 'DF-220' })).id;
    pastilha = (await createPart(t.app, dono, { name: 'Pastilha dianteira', manufacturerCode: 'PS-9' })).id;

    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    clienteId = cliente.id;
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'CMP1A23', make: 'Volkswagen', model: 'Gol' });
    carroId = carro.id;
    const servico = await post('/api/v1/services', { name: 'Troca de disco', priceCents: 15000 });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [
        { type: 'PART', partId: disco, quantity: 2, unitPriceCents: 32000, sourcing: 'TO_ORDER' },
        { type: 'PART', partId: pastilha, quantity: 1, unitPriceCents: 9000, sourcing: 'CUSTOMER_PROVIDED' },
        { type: 'SERVICE', serviceId: servico.json().id },
      ],
    });
    osId = os.id;
    osNumero = os.number;
    itemDisco = os.items.find((i) => i.description.includes('Disco'))!.id;
    itemDoCliente = os.items.find((i) => i.description.includes('Pastilha'))!.id;
    itemServico = os.items.find((i) => i.description.includes('Troca'))!.id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ================================ criar ====================================

  it('cria o rascunho com nome e código do cadastro, total com frete e a OS da peça', async () => {
    const pedido = await criarPedido({
      supplierId: central,
      shippingCents: 1500,
      items: [
        { partId: disco, quantity: 2, unitCostCents: 19500, workOrderItemId: itemDisco, description: 'NOME FORJADO' },
        { partId: pastilha, quantity: 1.5, unitCostCents: 4599 },
      ],
    });
    expect(pedido.status).toBe('DRAFT');
    expect(pedido.supplier.name).toBe('Central Autopeças');
    const [linhaDisco, linhaPastilha] = pedido.items;
    // o que vale é o cadastro, não o que a tela mandou
    expect(linhaDisco).toMatchObject({ description: 'Disco de freio ventilado', partCode: 'DF-220', quantity: 2, lineTotalCents: 39000 });
    expect(linhaDisco!.workOrder).toMatchObject({ id: osId, number: osNumero, itemId: itemDisco, vehicleLabel: 'Volkswagen Gol · CMP1A23' });
    // 1,5 × R$ 45,99 = R$ 68,985 → R$ 68,99
    expect(linhaPastilha!.lineTotalCents).toBe(6899);
    expect(pedido.itemsTotalCents).toBe(45899);
    expect(pedido.totalCents).toBe(47399);

    // e a OS mostra o que foi comprado para ela
    const daOs = await get(`/api/v1/work-orders/${osId}/purchases`);
    expect(daOs.statusCode, daOs.body).toBe(200);
    expect(daOs.json().data).toEqual([
      expect.objectContaining({ purchaseOrderId: pedido.id, workOrderItemId: itemDisco, quantity: 2, receivedQuantity: 0, status: 'DRAFT' }),
    ]);

    // limpa para os próximos cenários poderem comprar o disco da OS
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/cancel`, { reason: 'Rascunho de teste' })).statusCode).toBe(200);
  });

  it('gerente compra; financeiro só consulta; atendente e mecânico nem veem', async () => {
    const payload = { supplierId: central, items: [{ partId: pastilha, quantity: 1, unitCostCents: 100 }] };
    const doGerente = await post('/api/v1/purchase-orders', payload, gerente);
    expect(doGerente.statusCode, doGerente.body).toBe(201);
    const id = doGerente.json().id as string;

    expect((await post('/api/v1/purchase-orders', payload, financeiro)).statusCode).toBe(403);
    expect((await get(`/api/v1/purchase-orders/${id}`, financeiro)).statusCode).toBe(200);
    expect((await get('/api/v1/purchase-orders', financeiro)).statusCode).toBe(200);

    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    for (const s of [atendente, mecanico]) {
      expect((await get('/api/v1/purchase-orders', s)).statusCode).toBe(403);
      expect((await get(`/api/v1/purchase-orders/${id}`, s)).statusCode).toBe(403);
      expect((await post('/api/v1/purchase-orders', payload, s)).statusCode).toBe(403);
      expect((await get(`/api/v1/work-orders/${osId}/purchases`, s)).statusCode).toBe(403);
    }
  });

  it('fornecedor fora da lista ou de outra oficina, e peça de outra oficina, não entram', async () => {
    const vizinha = await signup(t.app);
    const deFora = await fornecedor('Fornecedor da Vizinha', vizinha);
    const pecaDeFora = (await createPart(t.app, vizinha, { name: 'Peça da vizinha' })).id;
    const tirado = await fornecedor('Tirado da Lista');
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v1/suppliers/${tirado}`, headers: bearer(dono.accessToken) })).statusCode).toBe(204);

    for (const supplierId of [deFora, tirado]) {
      const res = await post('/api/v1/purchase-orders', { supplierId, items: [{ partId: disco, quantity: 1, unitCostCents: 1 }] });
      expect(res.statusCode, res.body).toBe(400);
      expect(primeiroErro(res.body)).toBe('Fornecedor não encontrado');
    }
    const res = await post('/api/v1/purchase-orders', { supplierId: central, items: [{ partId: pecaDeFora, quantity: 1, unitCostCents: 1 }] });
    expect(res.statusCode, res.body).toBe(400);
    expect(primeiroErro(res.body)).toBe('Peça não encontrada');
  });

  it('só a peça certa da OS entra: serviço, peça do cliente e peça trocada são recusados', async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ partId: disco, quantity: 1, unitCostCents: 1, workOrderItemId: itemServico }, 'Só peça se compra'],
      [{ partId: pastilha, quantity: 1, unitCostCents: 1, workOrderItemId: itemDoCliente }, 'Peça trazida pelo cliente não se compra'],
      [{ partId: pastilha, quantity: 1, unitCostCents: 1, workOrderItemId: itemDisco }, 'A peça da OS é outra'],
    ];
    for (const [linha, mensagem] of casos) {
      const res = await post('/api/v1/purchase-orders', { supplierId: central, items: [linha] });
      expect(res.statusCode, res.body).toBe(400);
      expect(primeiroErro(res.body)).toBe(mensagem);
    }
  });

  it('a mesma peça da OS não entra em dois pedidos vivos; cancelado libera', async () => {
    const primeiro = await criarPedido({ supplierId: central, items: [{ partId: disco, quantity: 2, unitCostCents: 19500, workOrderItemId: itemDisco }] });
    const segundo = await post('/api/v1/purchase-orders', {
      supplierId: paulista,
      items: [{ partId: disco, quantity: 2, unitCostCents: 18000, workOrderItemId: itemDisco }],
    });
    expect(segundo.statusCode, segundo.body).toBe(400);
    expect(primeiroErro(segundo.body)).toBe(`Esta peça da OS já está no pedido nº ${primeiro.number}`);

    // editar o próprio rascunho com a mesma peça continua valendo
    const edicao = await patch(`/api/v1/purchase-orders/${primeiro.id}`, {
      version: primeiro.version,
      items: [{ partId: disco, quantity: 2, unitCostCents: 19000, workOrderItemId: itemDisco }],
    });
    expect(edicao.statusCode, edicao.body).toBe(200);

    expect((await post(`/api/v1/purchase-orders/${primeiro.id}/cancel`, { reason: 'Achei mais barato' })).statusCode).toBe(200);
    const agora = await post('/api/v1/purchase-orders', {
      supplierId: paulista,
      items: [{ partId: disco, quantity: 2, unitCostCents: 18000, workOrderItemId: itemDisco }],
    });
    expect(agora.statusCode, agora.body).toBe(201);
    expect((await post(`/api/v1/purchase-orders/${agora.json().id}/cancel`, { reason: 'Limpeza do teste' })).statusCode).toBe(200);
  });

  it('peça de OS entregue ou cancelada não se compra', async () => {
    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: disco, quantity: 1, unitPriceCents: 32000, sourcing: 'TO_ORDER' }],
    });
    expect((await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' })).statusCode).toBe(200);
    const res = await post('/api/v1/purchase-orders', {
      supplierId: central,
      items: [{ partId: disco, quantity: 1, unitCostCents: 1, workOrderItemId: os.items[0]!.id }],
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(primeiroErro(res.body)).toBe(`A OS ${os.number} já foi encerrada`);
  });

  // =============================== editar ====================================

  it('rascunho edita com a versão certa; versão velha é recusada', async () => {
    const pedido = await criarPedido({ supplierId: central, items: [{ partId: pastilha, quantity: 1, unitCostCents: 5000 }] });
    const ok = await patch(`/api/v1/purchase-orders/${pedido.id}`, {
      version: pedido.version,
      supplierId: paulista,
      shippingCents: 900,
      items: [
        { partId: pastilha, quantity: 4, unitCostCents: 4800 },
        { partId: disco, quantity: 1, unitCostCents: 19000 },
      ],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const editado = ok.json() as Pedido;
    expect(editado.supplier.name).toBe('Distribuidora Paulista');
    expect(editado.items.map((l) => [l.description, l.quantity])).toEqual([
      ['Pastilha dianteira', 4],
      ['Disco de freio ventilado', 1],
    ]);
    expect(editado.totalCents).toBe(4 * 4800 + 19000 + 900);
    expect(editado.version).toBe(pedido.version + 1);

    const velha = await patch(`/api/v1/purchase-orders/${pedido.id}`, { version: pedido.version, shippingCents: 0 });
    expect(velha.statusCode, velha.body).toBe(409);
    expect(velha.json().code).toBe('PURCHASE_ORDER_VERSION_CONFLICT');
  });

  // ============================ pedir e cancelar =============================

  it('marcar como pedido congela as linhas, avisa a OS e devolve a mensagem para o fornecedor', async () => {
    const pedido = await criarPedido({
      supplierId: central,
      shippingCents: 1500,
      items: [{ partId: disco, quantity: 2, unitCostCents: 19500, workOrderItemId: itemDisco }],
    });
    const res = await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: pedido.version, expectedOn: '2026-09-18' });
    expect(res.statusCode, res.body).toBe(200);
    const { order, message, whatsappUrl } = res.json() as { order: Pedido; message: string; whatsappUrl: string };
    expect(order.status).toBe('ORDERED');
    expect(order.orderedBy?.name).toBeTruthy();
    expect(message).toContain('Olá, Roberto!');
    expect(message).toContain(`pedido nº ${pedido.number}`);
    expect(message).toContain('2 un × Disco de freio ventilado (DF-220)');
    expect(message).toContain('195,00 cada');
    expect(message).toContain('Previsão de entrega: 18/09.');
    expect(whatsappUrl).toMatch(/^https:\/\/wa\.me\/5511988887777\?text=/);

    const timeline = (await get(`/api/v1/work-orders/${osId}/timeline`)).json().data as { type: string; data: { text?: string } }[];
    const evento = timeline.find((e) => e.type === 'PURCHASE_ORDERED');
    expect(evento?.data.text).toContain(`Pedido de compra nº ${pedido.number} feito a Central Autopeças`);

    // pedido feito não edita nem pede de novo
    const edicao = await patch(`/api/v1/purchase-orders/${pedido.id}`, { version: order.version, shippingCents: 0 });
    expect(edicao.statusCode, edicao.body).toBe(422);
    expect(edicao.json().code).toBe('PURCHASE_ORDER_STATE');
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: order.version })).statusCode).toBe(422);
    // encerrar o que falta sem nada recebido não existe: é cancelar
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/close`, { reason: 'Não vem' })).statusCode).toBe(422);

    // cancelar pedido feito conta para a OS que a peça não vem
    const cancelado = await post(`/api/v1/purchase-orders/${pedido.id}/cancel`, { reason: 'Fornecedor sem estoque' });
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    expect(cancelado.json()).toMatchObject({ status: 'CANCELED', cancelReason: 'Fornecedor sem estoque' });
    const depois = (await get(`/api/v1/work-orders/${osId}/timeline`)).json().data as { type: string; data: { text?: string } }[];
    expect(depois.some((e) => e.type === 'NOTE' && e.data.text?.includes(`nº ${pedido.number} cancelado`))).toBe(true);
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/cancel`, { reason: 'De novo' })).statusCode).toBe(422);
  });

  it('não marca como pedido com fornecedor que saiu da lista, nem com versão velha', async () => {
    const saiu = await fornecedor('Vai Sair');
    const pedido = await criarPedido({ supplierId: saiu, items: [{ partId: pastilha, quantity: 1, unitCostCents: 100 }] });
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: 99 })).statusCode).toBe(409);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v1/suppliers/${saiu}`, headers: bearer(dono.accessToken) })).statusCode).toBe(204);
    const res = await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: pedido.version });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json().detail).toContain('tirado da lista');
    // e a ficha continua mostrando de quem era
    expect(((await get(`/api/v1/purchase-orders/${pedido.id}`)).json() as Pedido).supplier).toMatchObject({ name: 'Vai Sair', removed: true });
  });

  it('com parte recebida: não cancela, mas encerra o que falta com motivo', async () => {
    const pedido = await criarPedido({ supplierId: central, items: [{ partId: pastilha, quantity: 4, unitCostCents: 4800 }] });
    await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: pedido.version });
    const feito = (await get(`/api/v1/purchase-orders/${pedido.id}`)).json() as Pedido;
    const chegada = await post(`/api/v1/purchase-orders/${pedido.id}/receipts`, {
      clientRequestId: '01a0b000-0000-7000-8000-000000000001',
      items: [{ purchaseOrderItemId: feito.items[0]!.id, quantity: 2, unitCostCents: 4800 }],
    });
    expect(chegada.statusCode, chegada.body).toBe(201);
    expect(chegada.json().status).toBe('PARTIAL');

    const cancelar = await post(`/api/v1/purchase-orders/${pedido.id}/cancel`, { reason: 'Quero cancelar' });
    expect(cancelar.statusCode, cancelar.body).toBe(422);
    expect(cancelar.json().detail).toBe('Não dá para cancelar um pedido com parte recebida.');

    const semMotivo = await post(`/api/v1/purchase-orders/${pedido.id}/close`, { reason: '' });
    expect(semMotivo.statusCode).toBe(400);
    const encerrar = await post(`/api/v1/purchase-orders/${pedido.id}/close`, { reason: 'Fornecedor não tem o resto' });
    expect(encerrar.statusCode, encerrar.body).toBe(200);
    expect(encerrar.json()).toMatchObject({ status: 'RECEIVED', closeReason: 'Fornecedor não tem o resto' });
    expect(encerrar.json().closedShortAt).toBeTruthy();
  });

  // ================================= lista ===================================

  it('lista em aberto por padrão, filtra por situação, fornecedor, número e nome sem acento', async () => {
    const aberto = await criarPedido({ supplierId: paulista, shippingCents: 500, items: [{ partId: disco, quantity: 3, unitCostCents: 1000 }] });
    const lista = async (qs: string) =>
      ((await get(`/api/v1/purchase-orders${qs}`)).json() as { data: { id: string; status: string; totalCents: number; itemCount: number }[] }).data;

    const emAberto = await lista('');
    expect(emAberto.every((p) => ['DRAFT', 'ORDERED', 'PARTIAL'].includes(p.status))).toBe(true);
    expect(emAberto.find((p) => p.id === aberto.id)).toMatchObject({ totalCents: 3500, itemCount: 1 });

    expect((await lista('?status=CANCELED')).every((p) => p.status === 'CANCELED')).toBe(true);
    expect((await lista('?status=all')).length).toBeGreaterThan(emAberto.length);
    const daPaulista = await lista(`?status=all&supplierId=${paulista}`);
    expect(daPaulista.length).toBeGreaterThan(0);
    expect(daPaulista.every((p) => (p as unknown as { supplierId: string }).supplierId === paulista)).toBe(true);
    expect((await lista(`?status=all&q=${aberto.number}`)).map((p) => p.id)).toContain(aberto.id);
    expect((await lista('?status=all&q=distribuidora%20PAULISTA')).map((p) => p.id)).toContain(aberto.id);
    expect((await lista('?status=all&q=Central')).map((p) => p.id)).not.toContain(aberto.id);
  });

  // =========================== a partir da cotação ===========================

  describe('a partir da cotação', () => {
    let cotacaoId: string;
    let requestDisco: string;
    let requestAvulsa: string;
    let ofertas: Map<string, { id: string; requestItemId: string }[]>;
    let itemDiscoDaOs: string;

    beforeAll(async () => {
      const os = await createWorkOrder(t.app, dono, {
        customerId: clienteId,
        vehicleId: carroId,
        items: [
          { type: 'PART', partId: disco, quantity: 2, unitPriceCents: 32000, sourcing: 'TO_ORDER' },
          { type: 'PART', partId: pastilha, quantity: 1, unitPriceCents: 9000, sourcing: 'TO_ORDER' },
          { type: 'PART', description: 'Parafuso de roda avulso', quantity: 4, unitPriceCents: 500 },
        ],
      });
      itemDiscoDaOs = os.items.find((i) => i.description.includes('Disco'))!.id;
      const criada = await post('/api/v1/supplier-quotes', {
        workOrderId: os.id,
        workOrderItemIds: os.items.map((i) => i.id),
        supplierIds: [central, paulista],
      });
      expect(criada.statusCode, criada.body).toBe(201);
      const { quote, links } = criada.json() as { quote: { id: string }; links: { supplierId: string; link: string }[] };
      cotacaoId = quote.id;

      // os dois respondem: a Central com frete R$ 15, a Paulista sem frete
      for (const [supplierId, precos, frete] of [
        [central, [19500, 5000, 80], 1500],
        [paulista, [21000, 4200, 90], 0],
      ] as const) {
        const token = links.find((l) => l.supplierId === supplierId)!.link.split('/').pop()!;
        const tela = (await t.app.inject({ method: 'GET', url: `/api/v1/public/supplier-quotes/${token}`, remoteAddress: nextIp() })).json() as {
          contentHash: string;
          items: { id: string; description: string }[];
        };
        const res = await t.app.inject({
          method: 'POST',
          url: `/api/v1/public/supplier-quotes/${token}/responses`,
          remoteAddress: nextIp(),
          payload: {
            contentHash: tela.contentHash,
            responderName: 'Vendedor',
            shippingCents: frete,
            items: tela.items.map((item, i) => ({ requestItemId: item.id, availability: 'AVAILABLE', unitPriceCents: precos[i], leadTimeDays: 1 })),
          },
        });
        expect(res.statusCode, res.body).toBe(200);
      }

      const quadro = (await get(`/api/v1/supplier-quotes/${cotacaoId}`)).json() as {
        items: { id: string; description: string }[];
        invites: { supplier: { id: string }; response: { items: { id: string; requestItemId: string }[] } }[];
      };
      requestDisco = quadro.items.find((i) => i.description.includes('Disco'))!.id;
      requestAvulsa = quadro.items.find((i) => i.description.includes('Parafuso'))!.id;
      const requestPastilha = quadro.items.find((i) => i.description.includes('Pastilha'))!.id;
      ofertas = new Map(quadro.invites.map((c) => [c.supplier.id, c.response.items]));
      const de = (supplierId: string, requestItemId: string) => ofertas.get(supplierId)!.find((o) => o.requestItemId === requestItemId)!.id;

      // disco e parafuso da Central, pastilha da Paulista
      const escolha = await post(`/api/v1/supplier-quotes/${cotacaoId}/award`, {
        awards: [
          { requestItemId: requestDisco, responseItemId: de(central, requestDisco) },
          { requestItemId: requestAvulsa, responseItemId: de(central, requestAvulsa) },
          { requestItemId: requestPastilha, responseItemId: de(paulista, requestPastilha) },
        ],
      });
      expect(escolha.statusCode, escolha.body).toBe(200);
    });

    it('um rascunho por fornecedor, com o preço e o frete que ele respondeu; peça sem cadastro fica de fora', async () => {
      const res = await post('/api/v1/purchase-orders/from-quote', { supplierQuoteRequestId: cotacaoId });
      expect(res.statusCode, res.body).toBe(201);
      const { orders, skipped } = res.json() as { orders: Pedido[]; skipped: { description: string; reason: string }[] };
      expect(orders).toHaveLength(2);
      const daCentral = orders.find((o) => o.supplier.id === central)!;
      const daPaulista = orders.find((o) => o.supplier.id === paulista)!;

      expect(daCentral.status).toBe('DRAFT');
      expect(daCentral.supplierQuote?.id).toBe(cotacaoId);
      expect(daCentral.shippingCents).toBe(1500);
      expect(daCentral.items).toHaveLength(1);
      expect(daCentral.items[0]).toMatchObject({ description: 'Disco de freio ventilado', quantity: 2, unitCostCents: 19500 });
      expect(daCentral.items[0]!.workOrder?.itemId).toBe(itemDiscoDaOs);
      expect(daCentral.items[0]!.supplierQuoteAwardId).toBeTruthy();

      expect(daPaulista.shippingCents).toBe(0);
      expect(daPaulista.items[0]).toMatchObject({ description: 'Pastilha dianteira', unitCostCents: 4200 });

      expect(skipped).toEqual([{ description: 'Parafuso de roda avulso', reason: 'peça sem cadastro no catálogo' }]);

      // o quadro da cotação passa a mostrar o pedido de cada escolha
      const quadro = (await get(`/api/v1/supplier-quotes/${cotacaoId}`)).json() as { items: { id: string; purchaseOrder: { number: number } | null }[] };
      expect(quadro.items.find((i) => i.id === requestDisco)!.purchaseOrder?.number).toBe(daCentral.number);
      expect(quadro.items.find((i) => i.id === requestAvulsa)!.purchaseOrder).toBeNull();
    });

    it('a mesma escolha não vira dois pedidos — nem depois de editar o rascunho', async () => {
      const lista = ((await get(`/api/v1/purchase-orders?supplierId=${central}`)).json() as { data: { id: string }[] }).data;
      const rascunho = (await get(`/api/v1/purchase-orders/${lista[0]!.id}`)).json() as Pedido;
      const editado = await patch(`/api/v1/purchase-orders/${rascunho.id}`, {
        version: rascunho.version,
        items: rascunho.items.map((l) => ({ partId: l.partId, quantity: l.quantity, unitCostCents: 19000, workOrderItemId: l.workOrder?.itemId ?? null })),
      });
      expect(editado.statusCode, editado.body).toBe(200);
      expect((editado.json() as Pedido).items[0]!.supplierQuoteAwardId).toBe(rascunho.items[0]!.supplierQuoteAwardId);

      const deNovo = await post('/api/v1/purchase-orders/from-quote', { supplierQuoteRequestId: cotacaoId });
      expect(deNovo.statusCode, deNovo.body).toBe(422);
      expect(deNovo.json().detail).toContain('já está no pedido nº');
    });

    it('escolha que virou pedido não se troca; cancelado o pedido, troca', async () => {
      const trocar = () =>
        post(`/api/v1/supplier-quotes/${cotacaoId}/award`, {
          awards: [{ requestItemId: requestDisco, responseItemId: ofertas.get(paulista)!.find((o) => o.requestItemId === requestDisco)!.id }],
        });
      const recusada = await trocar();
      expect(recusada.statusCode, recusada.body).toBe(422);
      expect(recusada.json().code).toBe('SUPPLIER_QUOTE_ORDERED');
      expect(recusada.json().detail).toContain('Disco de freio ventilado');

      const quadro = (await get(`/api/v1/supplier-quotes/${cotacaoId}`)).json() as { items: { id: string; purchaseOrder: { id: string } | null }[] };
      const pedidoId = quadro.items.find((i) => i.id === requestDisco)!.purchaseOrder!.id;
      expect((await post(`/api/v1/purchase-orders/${pedidoId}/cancel`, { reason: 'Vou trocar de fornecedor' })).statusCode).toBe(200);
      expect((await trocar()).statusCode).toBe(200);

      // e agora a troca gera o pedido da Paulista para o disco
      const gerado = await post('/api/v1/purchase-orders/from-quote', { supplierQuoteRequestId: cotacaoId });
      expect(gerado.statusCode, gerado.body).toBe(201);
      const { orders } = gerado.json() as { orders: Pedido[] };
      expect(orders).toHaveLength(1);
      expect(orders[0]!.supplier.id).toBe(paulista);
      expect(orders[0]!.items[0]).toMatchObject({ description: 'Disco de freio ventilado', unitCostCents: 21000 });
    });
  });

  // =============================== isolamento =================================

  it('oficina de fora não vê, não edita, não pede e não cancela: 404', async () => {
    const pedido = await criarPedido({ supplierId: central, items: [{ partId: pastilha, quantity: 1, unitCostCents: 100 }] });
    const vizinha = await signup(t.app);
    expect((await get(`/api/v1/purchase-orders/${pedido.id}`, vizinha)).statusCode).toBe(404);
    expect((await patch(`/api/v1/purchase-orders/${pedido.id}`, { version: 1, shippingCents: 0 }, vizinha)).statusCode).toBe(404);
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: 1 }, vizinha)).statusCode).toBe(404);
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/cancel`, { reason: 'Não é meu' }, vizinha)).statusCode).toBe(404);
    expect((await post('/api/v1/purchase-orders/from-quote', { supplierQuoteRequestId: pedido.id }, vizinha)).statusCode).toBe(404);
    const lista = (await get('/api/v1/purchase-orders?status=all', vizinha)).json() as { data: unknown[] };
    expect(lista.data).toEqual([]);
  });
});
