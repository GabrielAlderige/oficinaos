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
  signup,
  type TestApp,
  type TestSession,
} from './helpers';

interface Lancamento {
  id: string;
  direction: 'RECEIVABLE' | 'PAYABLE';
  status: string;
  situation: string;
  overdueDays: number;
  origin: string;
  description: string;
  amountCents: number;
  paidCents: number;
  remainingCents: number;
  dueDate: string;
  categoryName: string | null;
  customerName: string | null;
  supplierName: string | null;
  workOrderNumber: number | null;
  purchaseOrderNumber: number | null;
  installmentNumber: number;
  installmentCount: number;
  settlements?: { id: string; amountCents: number; status: string; paymentId: string | null }[];
}

/**
 * Financeiro (E13). O que precisa ficar provado: a conta a receber ESPELHA a
 * OS (valor e pagamento), a conta a pagar nasce da nota de compra e encolhe na
 * devolução, a baixa nunca passa do saldo nem acontece duas vezes, "vencida" é
 * calculada, e dinheiro é coisa de gerente/financeiro para cima.
 */
describe('financeiro', () => {
  let t: TestApp;
  let dono: TestSession;
  let financeiro: TestSession;
  let atendente: TestSession;
  let servicoId: string;
  let clienteId: string;
  let carroId: string;
  let categoriaAluguel: string;
  let categoriaPecas: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });
  const del = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'DELETE', url, headers: bearer(s.accessToken) });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  const hoje = () => new Date().toISOString().slice(0, 10);
  const emDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);

  async function criarLancamento(payload: Record<string, unknown>, s: TestSession = dono): Promise<Lancamento[]> {
    const res = await post('/api/v1/finance/entries', payload, s);
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Lancamento[] }).data;
  }

  const baixar = (id: string, payload: Record<string, unknown>, s: TestSession = dono) =>
    post(`/api/v1/finance/entries/${id}/settlements`, { clientRequestId: uuidv7(), ...payload }, s);

  const lancamento = async (id: string, s: TestSession = dono) =>
    (await get(`/api/v1/finance/entries/${id}`, s)).json() as Lancamento;

  /** OS aprovada e finalizada: é o que faz nascer a conta a receber. */
  async function osFinalizada(valorCents: number, placa: string) {
    const order = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'SERVICE', serviceId: servicoId, unitPriceCents: valorCents }],
    });
    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    expect((await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' })).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${order.id}/start`)).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${order.id}/complete`)).statusCode).toBe(200);
    void placa;
    return order;
  }

  async function contaDaOs(workOrderNumber: number): Promise<Lancamento> {
    const res = await get('/api/v1/finance/entries?direction=RECEIVABLE&filter=all&pageSize=100');
    expect(res.statusCode, res.body).toBe(200);
    const lista = (res.json() as { data: Lancamento[] }).data;
    const achado = lista.find((item) => item.workOrderNumber === workOrderNumber);
    expect(achado, `conta da OS ${workOrderNumber}`).toBeTruthy();
    return achado!;
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    servicoId = (await post('/api/v1/services', { name: 'Revisão completa', priceCents: 50000 })).json().id;
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    clienteId = cliente.id;
    carroId = (await createVehicle(t.app, dono, cliente.id, { plate: 'FIN1A23', make: 'Fiat', model: 'Uno' })).id;

    const categorias = (await get('/api/v1/finance/categories')).json() as {
      data: { id: string; name: string; systemKey: string | null; direction: string }[];
    };
    categoriaAluguel = categorias.data.find((c) => c.systemKey === 'RENT')!.id;
    categoriaPecas = categorias.data.find((c) => c.systemKey === 'PARTS')!.id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // =============================== categorias ================================

  it('a oficina nasce com as nove categorias do sistema, separadas por direção', async () => {
    const res = await get('/api/v1/finance/categories');
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data as { name: string; direction: string; systemKey: string | null }[];
    expect(data).toHaveLength(9);
    expect(data.filter((c) => c.direction === 'RECEIVABLE')).toHaveLength(2);
    expect(data.every((c) => c.systemKey !== null)).toBe(true);

    const soPagar = await get('/api/v1/finance/categories?direction=PAYABLE');
    expect((soPagar.json().data as unknown[]).length).toBe(7);
  });

  it('categoria do sistema se renomeia, mas não se apaga', async () => {
    const renomeou = await patch(`/api/v1/finance/categories/${categoriaAluguel}`, { name: 'Aluguel do galpão' });
    expect(renomeou.statusCode, renomeou.body).toBe(200);
    expect(renomeou.json().name).toBe('Aluguel do galpão');

    const apagou = await del(`/api/v1/finance/categories/${categoriaAluguel}`);
    expect(apagou.statusCode).toBe(422);
    expect(apagou.json().code).toBe('FINANCE_CATEGORY_IN_USE');
  });

  it('categoria nova não repete nome na mesma direção, e só some se ninguém usa', async () => {
    const criada = await post('/api/v1/finance/categories', { name: 'Marketing', direction: 'PAYABLE' });
    expect(criada.statusCode, criada.body).toBe(201);
    const repetida = await post('/api/v1/finance/categories', { name: 'marketing', direction: 'PAYABLE' });
    expect(repetida.statusCode).toBe(409);
    expect(repetida.json().code).toBe('FINANCE_CATEGORY_NAME_TAKEN');

    // mesmo nome na outra lista é outra categoria: uma é receita, a outra despesa
    expect((await post('/api/v1/finance/categories', { name: 'Marketing', direction: 'RECEIVABLE' })).statusCode).toBe(201);

    const id = criada.json().id as string;
    await criarLancamento({
      direction: 'PAYABLE',
      categoryId: id,
      description: 'Panfletos',
      amountCents: 20000,
      dueDate: hoje(),
    });
    const emUso = await del(`/api/v1/finance/categories/${id}`);
    expect(emUso.statusCode).toBe(422);
    expect(emUso.json().code).toBe('FINANCE_CATEGORY_IN_USE');
  });

  // ============================= conta a pagar ===============================

  it('conta a pagar avulsa: baixa parcial, baixa final e cancelamento da baixa', async () => {
    const [conta] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Aluguel de setembro',
      amountCents: 250000,
      dueDate: emDias(5),
    });
    expect(conta!.status).toBe('OPEN');
    expect(conta!.remainingCents).toBe(250000);

    const parcial = await baixar(conta!.id, { amountCents: 100000, method: 'PIX' });
    expect(parcial.statusCode, parcial.body).toBe(201);
    expect(parcial.json()).toMatchObject({ status: 'PARTIAL', paidCents: 100000, remainingCents: 150000 });

    const resto = await baixar(conta!.id, { amountCents: 150000, method: 'BANK_TRANSFER' });
    expect(resto.statusCode, resto.body).toBe(201);
    expect(resto.json()).toMatchObject({ status: 'PAID', situation: 'PAID', remainingCents: 0 });

    // baixa em lançamento quitado não passa
    const sobra = await baixar(conta!.id, { amountCents: 100, method: 'CASH' });
    expect(sobra.statusCode).toBe(422);
    expect(sobra.json().code).toBe('FINANCE_ENTRY_STATE');

    // cancelar a última baixa devolve o lançamento para parcial
    const baixas = (await lancamento(conta!.id)).settlements!;
    const ultima = baixas.find((b) => b.amountCents === 150000)!;
    const cancelou = await post(`/api/v1/finance/settlements/${ultima.id}/cancel`, { reason: 'Transferência não caiu' });
    expect(cancelou.statusCode, cancelou.body).toBe(200);
    expect(cancelou.json()).toMatchObject({ status: 'PARTIAL', paidCents: 100000 });
  });

  it('baixa acima do saldo é recusada, e o mesmo pedido repetido não baixa duas vezes', async () => {
    const [conta] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Energia elétrica',
      amountCents: 80000,
      dueDate: emDias(3),
    });

    const demais = await baixar(conta!.id, { amountCents: 80001, method: 'PIX' });
    expect(demais.statusCode).toBe(422);
    expect(demais.json().code).toBe('FINANCE_EXCEEDS_BALANCE');

    const chave = uuidv7();
    const primeira = await post(`/api/v1/finance/entries/${conta!.id}/settlements`, {
      clientRequestId: chave,
      amountCents: 30000,
      method: 'PIX',
    });
    expect(primeira.statusCode, primeira.body).toBe(201);
    const repetida = await post(`/api/v1/finance/entries/${conta!.id}/settlements`, {
      clientRequestId: chave,
      amountCents: 30000,
      method: 'PIX',
    });
    expect(repetida.statusCode, repetida.body).toBe(201);
    expect(repetida.json().paidCents, 'clique duplo não baixa duas vezes').toBe(30000);
  });

  it('vencida é calculada: o vencimento no passado com saldo vira OVERDUE, e quitada não vence', async () => {
    const [atrasada] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Conta atrasada',
      amountCents: 10000,
      dueDate: emDias(-3),
    });
    expect(atrasada!.situation).toBe('OVERDUE');
    expect(atrasada!.overdueDays).toBe(3);

    const vencidas = await get('/api/v1/finance/entries?direction=PAYABLE&filter=overdue');
    expect(vencidas.statusCode, vencidas.body).toBe(200);
    const corpo = vencidas.json() as { data: Lancamento[]; summary: { overdueCents: number; overdueCount: number } };
    expect(corpo.data.some((item) => item.id === atrasada!.id)).toBe(true);
    expect(corpo.summary.overdueCents).toBeGreaterThanOrEqual(10000);

    await baixar(atrasada!.id, { amountCents: 10000, method: 'CASH' });
    expect((await lancamento(atrasada!.id)).situation).toBe('PAID');
  });

  it('parcelamento na criação divide sem perder centavo e vence de mês em mês', async () => {
    const parcelas = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Compressor novo',
      amountCents: 90001,
      dueDate: '2026-01-31',
      installments: 3,
    });
    expect(parcelas).toHaveLength(3);
    expect(parcelas.map((p) => p.amountCents)).toEqual([30001, 30000, 30000]);
    expect(parcelas.map((p) => p.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(parcelas.map((p) => `${p.installmentNumber}/${p.installmentCount}`)).toEqual(['1/3', '2/3', '3/3']);
  });

  // ============================ conta a receber ==============================

  it('OS finalizada vira conta a receber com o valor aprovado, e o pagamento da OS a quita', async () => {
    const os = await osFinalizada(50000, 'FIN1A23');
    const conta = await contaDaOs(os.number);
    expect(conta).toMatchObject({
      origin: 'WORK_ORDER',
      direction: 'RECEIVABLE',
      amountCents: 50000,
      paidCents: 0,
      status: 'OPEN',
      customerName: 'João Pereira',
      categoryName: 'Serviços e peças',
    });
    expect(conta.description).toBe(`OS nº ${os.number}`);

    // o caixa da OS (E7) é quem recebe; a conta acompanha
    const pagou = await post(`/api/v1/work-orders/${os.id}/payments`, { method: 'PIX', amountCents: 20000 });
    expect(pagou.statusCode, pagou.body).toBe(201);
    const parcial = await lancamento(conta.id);
    expect(parcial).toMatchObject({ status: 'PARTIAL', paidCents: 20000, remainingCents: 30000 });
    expect(parcial.settlements!.some((b) => b.paymentId !== null && b.amountCents === 20000)).toBe(true);

    // e a baixa pela tela do financeiro grava no caixa da OS
    const baixou = await baixar(conta.id, { amountCents: 30000, method: 'CASH' });
    expect(baixou.statusCode, baixou.body).toBe(201);
    expect(baixou.json()).toMatchObject({ status: 'PAID', paidCents: 50000 });

    // a ficha da OS abre pelo NÚMERO (é a URL que a oficina lê)
    const osDepois = (await get(`/api/v1/work-orders/${os.number}`)).json() as {
      paymentStatus: string;
      totals: { paidCents: number };
    };
    expect(osDepois.paymentStatus, 'a baixa do financeiro é o pagamento da OS').toBe('PAID');
    expect(osDepois.totals.paidCents).toBe(50000);
  });

  it('o valor da conta de uma OS vem da OS: editar aqui é recusado, e mudar lá chega aqui', async () => {
    const os = await osFinalizada(30000, 'FIN1A23');
    const conta = await contaDaOs(os.number);

    const tentou = await patch(`/api/v1/finance/entries/${conta.id}`, { amountCents: 999 });
    expect(tentou.statusCode).toBe(422);
    expect(tentou.json().code).toBe('FINANCE_ENTRY_MIRRORED');

    // o que a conta espelha é o APROVADO: item novo em rascunho não muda nada
    expect((await post(`/api/v1/work-orders/${os.id}/reopen`)).statusCode).toBe(200);
    const novoItem = await post(`/api/v1/work-orders/${os.id}/items`, {
      type: 'SERVICE',
      serviceId: servicoId,
      unitPriceCents: 10000,
    });
    expect(novoItem.statusCode, novoItem.body).toBe(201);
    expect((await lancamento(conta.id)).amountCents, 'item ainda não aprovado não entra na conta').toBe(30000);

    // aprovado o complementar, a conta acompanha sozinha
    const complementar = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    expect(
      (await post(`/api/v1/quotes/${complementar.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' })).statusCode,
    ).toBe(200);
    expect((await lancamento(conta.id)).amountCents).toBe(40000);

    // o vencimento, sim, é da oficina: "combinei receber dia 10"
    const adiou = await patch(`/api/v1/finance/entries/${conta.id}`, { dueDate: emDias(10) });
    expect(adiou.statusCode, adiou.body).toBe(200);
    expect(adiou.json().dueDate).toBe(emDias(10));
  });

  it('parcelar a conta da OS espalha o que já foi pago da parcela mais velha para a mais nova', async () => {
    const os = await osFinalizada(90000, 'FIN1A23');
    const conta = await contaDaOs(os.number);
    expect((await post(`/api/v1/work-orders/${os.id}/payments`, { method: 'PIX', amountCents: 40000 })).statusCode).toBe(201);

    const parcelou = await post(`/api/v1/finance/entries/${conta.id}/installments`, {
      installments: 3,
      firstDueDate: '2026-03-10',
    });
    expect(parcelou.statusCode, parcelou.body).toBe(201);
    const parcelas = (parcelou.json() as { data: Lancamento[] }).data;
    expect(parcelas.map((p) => p.amountCents)).toEqual([30000, 30000, 30000]);
    // R$ 400 pagos: a 1ª quitada, a 2ª com R$ 100, a 3ª intocada
    expect(parcelas.map((p) => p.paidCents)).toEqual([30000, 10000, 0]);
    expect(parcelas.map((p) => p.status)).toEqual(['PAID', 'PARTIAL', 'OPEN']);
    expect(parcelas.map((p) => p.dueDate)).toEqual(['2026-03-10', '2026-04-10', '2026-05-10']);
  });

  it('OS cancelada cancela a conta a receber, com motivo', async () => {
    const os = await osFinalizada(25000, 'FIN1A23');
    const conta = await contaDaOs(os.number);
    expect(conta.status).toBe('OPEN');

    expect((await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' })).statusCode).toBe(200);
    const depois = await lancamento(conta.id);
    expect(depois.status).toBe('CANCELED');
    expect(depois.situation).toBe('CANCELED');
  });

  it('lançamento com baixa não se cancela: primeiro se cancela a baixa', async () => {
    const [conta] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Internet',
      amountCents: 15000,
      dueDate: hoje(),
    });
    await baixar(conta!.id, { amountCents: 5000, method: 'PIX' });
    const recusou = await post(`/api/v1/finance/entries/${conta!.id}/cancel`, { reason: 'Lançado errado' });
    expect(recusou.statusCode).toBe(422);
    expect(recusou.json().code).toBe('FINANCE_ENTRY_STATE');
  });

  // ============================ compra e devolução ===========================

  it('a nota recebida vira conta a pagar (com frete), e a devolução abate', async () => {
    const fornecedor = (await post('/api/v1/suppliers', { name: 'Central Autopeças' })).json().id as string;
    const filtro = (await createPart(t.app, dono, { name: 'Filtro de óleo' })).id;

    const pedido = (await post('/api/v1/purchase-orders', {
      supplierId: fornecedor,
      items: [{ partId: filtro, quantity: 10, unitCostCents: 2000 }],
    })).json() as { id: string; number: number; version: number };
    expect((await post(`/api/v1/purchase-orders/${pedido.id}/order`, { version: pedido.version })).statusCode).toBe(200);

    const recebeu = await post(`/api/v1/purchase-orders/${pedido.id}/receipts`, {
      clientRequestId: uuidv7(),
      invoiceNumber: '12345',
      shippingCents: 3000,
      payableDueDate: emDias(30),
      items: [{ purchaseOrderItemId: (await get(`/api/v1/purchase-orders/${pedido.id}`)).json().items[0].id, quantity: 10, unitCostCents: 2000 }],
    });
    expect(recebeu.statusCode, recebeu.body).toBe(201);

    const lista = (await get('/api/v1/finance/entries?direction=PAYABLE&filter=all&pageSize=100')).json() as { data: Lancamento[] };
    const conta = lista.data.find((item) => item.purchaseOrderNumber === pedido.number)!;
    expect(conta, 'a compra recebida gera conta a pagar').toBeTruthy();
    // 10 × R$ 20 + R$ 30 de frete
    expect(conta).toMatchObject({
      amountCents: 23000,
      supplierName: 'Central Autopeças',
      categoryName: 'Peças e insumos',
      origin: 'PURCHASE',
      dueDate: emDias(30),
    });
    expect(conta.description).toBe(`Compra nº ${pedido.number} — NF 12345`);

    // devolveu 2 peças: a conta encolhe pelo custo com que a peça ENTROU
    // (R$ 20 + R$ 3 de frete rateado = R$ 23 cada). Assim, devolver a nota
    // inteira zera a conta, em vez de deixar o frete pendurado
    const linha = (await get(`/api/v1/purchase-orders/${pedido.id}`)).json().items[0].id as string;
    const devolveu = await post(`/api/v1/purchase-orders/${pedido.id}/returns`, {
      clientRequestId: uuidv7(),
      reason: 'Filtro errado',
      items: [{ purchaseOrderItemId: linha, quantity: 2 }],
    });
    expect(devolveu.statusCode, devolveu.body).toBe(201);
    expect((await lancamento(conta.id)).amountCents).toBe(18400);
  });

  // ======================= fluxo de caixa e lucro =============================

  it('o fluxo de caixa separa o que entrou do que saiu e mostra o previsto', async () => {
    const res = await get('/api/v1/finance/cash-flow?period=month&step=day');
    expect(res.statusCode, res.body).toBe(200);
    const fluxo = res.json() as {
      buckets: { key: string; inCents: number; outCents: number; runningCents: number }[];
      inCents: number;
      outCents: number;
      netCents: number;
      expectedInCents: number;
      expectedOutCents: number;
    };
    expect(fluxo.inCents).toBeGreaterThan(0);
    expect(fluxo.outCents).toBeGreaterThan(0);
    expect(fluxo.netCents).toBe(fluxo.inCents - fluxo.outCents);
    expect(fluxo.buckets.length).toBeGreaterThan(0);
    // o acumulado do último balde é a soma de todos os dias
    expect(fluxo.buckets.at(-1)!.runningCents).toBe(fluxo.netCents);
    expect(fluxo.expectedOutCents).toBeGreaterThan(0);
  });

  it('o lucro estimado tira as peças da despesa: elas já entram pelo custo da peça usada', async () => {
    const [conta] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaPecas,
      description: 'Nota de peças fora do sistema',
      amountCents: 70000,
      dueDate: hoje(),
    });
    await baixar(conta!.id, { amountCents: 70000, method: 'PIX' });

    const res = await get('/api/v1/finance/profit?period=month');
    expect(res.statusCode, res.body).toBe(200);
    const lucro = res.json() as {
      receitaCents: number;
      custoPecasCents: number;
      despesasCents: number;
      lucroCents: number;
      despesasPorCategoria: { name: string; amountCents: number }[];
    };
    expect(lucro.receitaCents).toBeGreaterThan(0);
    expect(lucro.lucroCents).toBe(lucro.receitaCents - lucro.custoPecasCents - lucro.despesasCents);
    // a nota de peças aparece na lista, mas não na despesa que desconta o lucro
    const pecas = lucro.despesasPorCategoria.find((linha) => linha.name === 'Peças e insumos');
    expect(pecas!.amountCents).toBeGreaterThanOrEqual(70000);
    const somaDaLista = lucro.despesasPorCategoria.reduce((soma, linha) => soma + linha.amountCents, 0);
    expect(lucro.despesasCents).toBe(somaDaLista - pecas!.amountCents);
  });

  it('o custo das peças usadas é quantidade × custo médio, em centavos', async () => {
    // 3 peças a R$ 90 de custo saindo numa OS = R$ 270 de custo
    const peca = await createPart(t.app, dono, {
      name: 'Amortecedor dianteiro',
      salePriceCents: 30000,
      initialQuantity: 10,
      initialUnitCostCents: 9000,
    });
    const antes = (await get('/api/v1/finance/profit?period=month')).json().custoPecasCents as number;

    const os = await createWorkOrder(t.app, dono, {
      customerId: clienteId,
      vehicleId: carroId,
      items: [{ type: 'PART', partId: peca.id, quantity: 3, unitPriceCents: 30000 }],
    });
    const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${os.id}/start`);
    expect((await post(`/api/v1/work-orders/${os.id}/complete`)).statusCode).toBe(200);

    const depois = (await get('/api/v1/finance/profit?period=month')).json().custoPecasCents as number;
    expect(depois - antes, 'quantidade não é milésimo: 3 × R$ 90 = R$ 270').toBe(27000);
  });

  // ============================== acesso =====================================

  it('financeiro mexe; atendente e mecânico não entram', async () => {
    const [conta] = await criarLancamento({
      direction: 'PAYABLE',
      categoryId: categoriaAluguel,
      description: 'Água',
      amountCents: 9000,
      dueDate: hoje(),
    });

    expect((await get('/api/v1/finance/entries?direction=PAYABLE', financeiro)).statusCode).toBe(200);
    const doFinanceiro = await baixar(conta!.id, { amountCents: 9000, method: 'PIX' }, financeiro);
    expect(doFinanceiro.statusCode, doFinanceiro.body).toBe(201);

    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    for (const s of [atendente, mecanico]) {
      expect((await get('/api/v1/finance/entries?direction=RECEIVABLE', s)).statusCode).toBe(403);
      expect((await get('/api/v1/finance/cash-flow', s)).statusCode).toBe(403);
      expect((await post('/api/v1/finance/entries', {}, s)).statusCode).toBe(403);
    }
  });

  it('lançamento de outra oficina não existe para esta (404, nunca 403)', async () => {
    const outra = await signup(t.app, { organizationName: 'Oficina Vizinha' });
    const categorias = (await get('/api/v1/finance/categories', outra)).json() as { data: { id: string }[] };
    const [dela] = await criarLancamento(
      {
        direction: 'PAYABLE',
        categoryId: categorias.data[0]!.id,
        description: 'Conta da vizinha',
        amountCents: 1000,
        dueDate: hoje(),
      },
      outra,
    );

    expect((await get(`/api/v1/finance/entries/${dela!.id}`)).statusCode).toBe(404);
    expect((await patch(`/api/v1/finance/entries/${dela!.id}`, { description: 'invasão' })).statusCode).toBe(404);
    expect((await baixar(dela!.id, { amountCents: 100, method: 'PIX' })).statusCode).toBe(404);

    const minhas = (await get('/api/v1/finance/entries?direction=PAYABLE&filter=all&pageSize=100')).json() as {
      data: Lancamento[];
    };
    expect(minhas.data.some((item) => item.description === 'Conta da vizinha')).toBe(false);
  });
});
