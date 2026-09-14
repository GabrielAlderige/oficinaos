import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';
import { withTenant } from '../src/db/tenant';

interface TestSummary {
  period: { from: string; to: string; label: string };
  billedCents: number | null;
  receivedCents: number | null;
  avgTicketCents: number | null;
  openByStatus: { status: string; count: number }[];
  vehiclesInShop: number;
  appointmentsToday: number;
  completedOrders: number;
  completedServices: number;
  vehiclesServed: number;
  newCustomers: number;
  approval: {
    answered: number;
    approved: number;
    pending: number;
    offeredCents: number | null;
    approvedCents: number | null;
  };
  topServices: { name: string; count: number }[];
  topParts: { name: string; quantity: number }[];
}

interface TestAttention {
  groups: { key: string; count: number; items: { label: string; detail: string; to: string }[] }[];
}

/**
 * Dashboard (E9). O que precisa ficar provado: **faturado e recebido são
 * contas diferentes**, quem não pode ver dinheiro recebe `null` (e não zero), e
 * o "Atenção necessária" mostra o que de fato está travado.
 */
describe('dashboard', () => {
  let t: TestApp;
  let owner: TestSession;
  let mecanico: TestSession;
  let serviceId: string;
  let customerId: string;
  let vehicleId: string;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
    mecanico = await addMember(t.app, owner, 'MECHANIC', 'Zé Mecânico');
    const servico = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Troca de pastilhas', priceCents: 18000 },
    });
    serviceId = servico.json().id;
    const cliente = await createCustomer(t.app, owner, { name: 'João Pereira' });
    customerId = cliente.id;
    vehicleId = (await createVehicle(t.app, owner, customerId, { plate: 'DSH1A23' })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  const post = (url: string, payload: Record<string, unknown> = {}, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });
  const get = (url: string, s: TestSession = owner) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /**
   * O Intl escreve "R$ 150,00" com espaço INQUEBRÁVEL. Sem trocar, a comparação
   * falha por um caractere invisível — já custou uma rodada na E6. Os escapes
   * ficam explícitos: o NBSP digitado vira espaço comum ao salvar, e o lint
   * recusa o literal.
   */
  const semEspacoEstranho = (texto: string) => texto.replace(/[\u00a0\u202f\u2009]/g, ' ');

  const resumo = async (s: TestSession = owner, periodo = 'today') =>
    (await get(`/api/v1/dashboard/summary?period=${periodo}`, s)).json() as TestSummary;

  /** OS aprovada de R$ 180,00, finalizada agora: é o que entra no "faturado". */
  async function osFinalizada(placa: string) {
    const veiculo = await createVehicle(t.app, owner, customerId, { plate: placa });
    const order = await createWorkOrder(t.app, owner, {
      customerId,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${quote.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${order.id}/start`);
    const fim = await post(`/api/v1/work-orders/${order.id}/complete`);
    expect(fim.statusCode, fim.body).toBe(200);
    return order;
  }

  it('separa o que foi faturado do que foi recebido', async () => {
    const order = await osFinalizada('DSH2B34');

    const antes = await resumo();
    expect(antes.billedCents, 'R$ 180,00 de serviço entregue hoje').toBe(18000);
    expect(antes.receivedCents, 'ninguém pagou ainda').toBe(0);
    expect(antes.completedOrders).toBe(1);
    expect(antes.completedServices).toBe(1);
    expect(antes.vehiclesServed).toBe(1);
    expect(antes.avgTicketCents).toBe(18000);

    const lancamento = await post(`/api/v1/work-orders/${order.id}/payments`, {
      method: 'PIX',
      amountCents: 5000,
    });
    const depois = await resumo();
    expect(depois.billedCents, 'faturar não muda com o pagamento').toBe(18000);
    expect(depois.receivedCents, 'entraram R$ 50,00').toBe(5000);

    // lançamento cancelado não é dinheiro que entrou: o recebido volta
    const pagamentoId = (lancamento.json() as { data: { id: string }[] }).data[0]!.id;
    const cancelado = await post(`/api/v1/payments/${pagamentoId}/cancel`, { reason: 'Pix não caiu' });
    expect(cancelado.statusCode, cancelado.body).toBe(200);
    const semPagamento = await resumo();
    expect(semPagamento.receivedCents, 'cancelado sai do recebido').toBe(0);
    expect(semPagamento.billedCents, 'e o faturado continua o mesmo').toBe(18000);

    // devolve o pagamento para as contas seguintes continuarem de pé
    await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'PIX', amountCents: 5000 });
  });

  it('o faturado é o que o cliente APROVOU, não o total oferecido', async () => {
    // OS com dois serviços: o cliente aprova só um. Faturar o total seria contar
    // dinheiro que ninguém autorizou.
    const antes = (await resumo()).billedCents!;
    const veiculo = await createVehicle(t.app, owner, customerId, { plate: 'DSH5E67' });
    const outro = await t.app.inject({
      method: 'POST',
      url: '/api/v1/services',
      headers: bearer(owner.accessToken),
      payload: { name: 'Alinhamento', priceCents: 12000 },
    });
    const order = await createWorkOrder(t.app, owner, {
      customerId,
      vehicleId: veiculo.id,
      items: [
        { type: 'SERVICE', serviceId },
        { type: 'SERVICE', serviceId: outro.json().id, isOptional: true },
      ],
    });
    const quote = (await post(`/api/v1/work-orders/${order.id}/quotes`, {})).json() as {
      id: string;
      items: { id: string; description: string }[];
    };
    const soPastilhas = quote.items.find((item) => item.description.includes('pastilhas'))!;
    const parcial = await post(`/api/v1/quotes/${quote.id}/manual-decision`, {
      decision: 'PARTIALLY_APPROVED',
      channel: 'PHONE',
      approvedItemIds: [soPastilhas.id],
    });
    expect(parcial.statusCode, parcial.body).toBe(200);
    await post(`/api/v1/work-orders/${order.id}/start`);
    await post(`/api/v1/work-orders/${order.id}/complete`);

    const depois = await resumo();
    expect(depois.billedCents! - antes, 'entra o APROVADO (R$ 180,00), não o oferecido (R$ 300,00)').toBe(18000);

    // com mais de uma OS no período, o ticket médio deixa de ser o próprio total
    expect(depois.completedOrders).toBeGreaterThan(1);
    expect(depois.avgTicketCents).toBe(Math.round(depois.billedCents! / depois.completedOrders));
    expect(depois.avgTicketCents).not.toBe(depois.billedCents);
  });

  it('quem não pode ver dinheiro recebe nulo, não zero', async () => {
    const doMecanico = await resumo(mecanico);
    expect(doMecanico.billedCents).toBeNull();
    expect(doMecanico.receivedCents).toBeNull();
    expect(doMecanico.avgTicketCents).toBeNull();
    expect(doMecanico.approval.offeredCents).toBeNull();
    // o que não é dinheiro ele continua vendo: o pátio é trabalho dele
    expect(doMecanico.completedOrders).toBeGreaterThan(0);
    expect(doMecanico.vehiclesInShop).toBeGreaterThanOrEqual(0);

    const grafico = await get('/api/v1/dashboard/charts?metric=revenue&period=today', mecanico);
    expect(grafico.statusCode, grafico.body).toBe(200);
    expect(grafico.json().points, 'sem permissão, a série de dinheiro não existe').toEqual([]);
  });

  it('conta a taxa de aprovação pela resposta do cliente', async () => {
    const dados = await resumo();
    expect(dados.approval.answered).toBeGreaterThan(0);
    expect(dados.approval.approved).toBe(dados.approval.answered);
    // houve uma aprovação parcial: o valor aprovado é menor que o oferecido,
    // e é isso que separa "taxa em quantidade" de "taxa em valor"
    expect(dados.approval.approvedCents!).toBeLessThan(dados.approval.offeredCents!);
  });

  it('o período de hoje é o dia da oficina, e o gráfico tem um ponto por dia', async () => {
    const hoje = await resumo(owner, 'today');
    expect(hoje.period.from).toBe(hoje.period.to);

    const mes = await get('/api/v1/dashboard/charts?metric=revenue&period=month');
    const pontos = mes.json().points as { day: string; value: number }[];
    expect(pontos.length).toBeGreaterThanOrEqual(28);
    // o gráfico e o resumo contam a mesma coisa: tudo foi finalizado hoje
    const noDia = pontos.find((ponto) => ponto.day === hoje.period.from);
    expect(noDia?.value, 'o dia da finalização soma o mesmo que o resumo').toBe(hoje.billedCents);
    expect(pontos.some((p) => p.value === 0), 'dia sem movimento vem zerado, não some').toBe(true);
  });

  it('o painel de atenção mostra o que está travado, com caminho para resolver', async () => {
    // orçamento enviado e sem resposta
    const veiculo = await createVehicle(t.app, owner, customerId, { plate: 'DSH3C45' });
    const order = await createWorkOrder(t.app, owner, {
      customerId,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    await post(`/api/v1/work-orders/${order.id}/quotes`, {});

    const atencao = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    const esperando = atencao.groups.find((g) => g.key === 'QUOTES_WAITING');
    expect(esperando, 'o orçamento sem resposta precisa aparecer').toBeTruthy();
    expect(esperando!.count).toBe(1);
    expect(esperando!.items[0]!.label).toContain(`OS ${order.number}`);
    expect(esperando!.items[0]!.to).toBe(`/ordens/${order.number}`);
    expect(esperando!.items[0]!.detail).toContain('enviado');

    // recém-enviado não entra em "nem abriu": esse grupo é de 24 h atrás
    expect(atencao.groups.find((g) => g.key === 'QUOTES_UNSEEN')).toBeUndefined();
  });

  it('orçamento que o cliente nem abriu sai do grupo de espera, para não repetir', async () => {
    // envelhecer o envio é a única forma de chegar no grupo de 24 h
    const { db } = testDb();
    await withTenant(db, { organizationId: owner.orgId }, (tx) =>
      tx.execute(sql`update quotes set sent_at = now() - interval '2 days' where status = 'SENT'`),
    );

    const atencao = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    const naoAbriu = atencao.groups.find((g) => g.key === 'QUOTES_UNSEEN');
    const esperando = atencao.groups.find((g) => g.key === 'QUOTES_WAITING');
    expect(naoAbriu?.count, 'o orçamento envelhecido vira "nem abriu"').toBe(1);
    expect(esperando, 'e some do grupo de espera, senão o painel se repete').toBeUndefined();
    expect(naoAbriu!.items[0]!.detail).toContain('não visualizado');
    // e grupo vazio não aparece: painel cheio de zero ensina a ignorar
    expect(atencao.groups.every((g) => g.count > 0)).toBe(true);
  });

  it('entregar devendo cai no painel, com quanto falta', async () => {
    const order = await osFinalizada('DSH4D56');
    await post(`/api/v1/work-orders/${order.id}/payments`, { method: 'CASH', amountCents: 3000 });
    const entrega = await post(`/api/v1/work-orders/${order.id}/deliver`);
    expect(entrega.statusCode, entrega.body).toBe(200);

    const atencao = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    const devendo = atencao.groups.find((g) => g.key === 'DELIVERED_UNPAID');
    expect(devendo, 'entregue com saldo em aberto').toBeTruthy();
    expect(semEspacoEstranho(devendo!.items[0]!.detail)).toContain('R$ 150,00');

    // o mecânico vê o carro na lista, mas não o valor em aberto
    const doMecanico = (await get('/api/v1/dashboard/attention', mecanico)).json() as TestAttention;
    const mesmoGrupo = doMecanico.groups.find((g) => g.key === 'DELIVERED_UNPAID');
    expect(mesmoGrupo!.items[0]!.detail).not.toContain('R$');
  });

  it('agendamento de hoje sem confirmação aparece, e some ao confirmar', async () => {
    const agora = new Date();
    const criado = await post('/api/v1/appointments', {
      customerId,
      vehicleId,
      title: 'Revisão dos 10.000 km',
      startsAt: new Date(agora.getTime() + 60_000).toISOString(),
      endsAt: new Date(agora.getTime() + 3_660_000).toISOString(),
    });
    expect(criado.statusCode, criado.body).toBe(201);

    const antes = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    expect(antes.groups.find((g) => g.key === 'APPOINTMENTS_UNCONFIRMED')?.count).toBe(1);
    expect((await resumo()).appointmentsToday).toBe(1);

    await post(`/api/v1/appointments/${criado.json().id}/confirm`);
    const depois = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    expect(depois.groups.find((g) => g.key === 'APPOINTMENTS_UNCONFIRMED')).toBeUndefined();
    expect((await resumo()).appointmentsToday, 'confirmado continua sendo compromisso de hoje').toBe(1);
  });

  it('oficina de fora não vê número nenhum', async () => {
    const vizinha = await signup(t.app);
    const dela = await resumo(vizinha);
    expect(dela.billedCents).toBe(0);
    expect(dela.completedOrders).toBe(0);
    expect(dela.vehiclesInShop).toBe(0);
    expect((await get('/api/v1/dashboard/attention', vizinha)).json().groups).toEqual([]);
  });
  /**
   * O critério da E8 continua valendo aqui: **o dia é o da oficina**. O fuso é
   * escolhido para a data local NUNCA coincidir com a do UTC — antes das 11h
   * UTC, Midway (UTC−11) ainda está na véspera; depois, Kiritimati (UTC+14) já
   * está no dia seguinte. Se a série agrupasse por UTC, o ponto cairia noutro dia.
   */
  it('agrupa a série pelo calendário da oficina, não pelo do servidor', async () => {
    const fuso = new Date().getUTCHours() < 11 ? 'Pacific/Midway' : 'Pacific/Kiritimati';
    const { db } = testDb();
    await withTenant(db, { organizationId: owner.orgId }, (tx) =>
      tx.execute(sql`update organizations set timezone = ${fuso} where id = ${owner.orgId}`),
    );

    const hoje = await resumo(owner, 'today');
    const emUtc = new Date().toISOString().slice(0, 10);
    expect(hoje.period.from, 'o dia da oficina não é o do UTC neste fuso').not.toBe(emUtc);

    const grafico = await get('/api/v1/dashboard/charts?metric=revenue&period=today');
    const pontos = grafico.json().points as { day: string; value: number }[];
    expect(pontos).toHaveLength(1);
    expect(pontos[0]!.day).toBe(hoje.period.from);
    expect(pontos[0]!.value, 'o faturado do dia da oficina').toBe(hoje.billedCents);
  });
  it('OS cancelada tira o orçamento da fila de espera', async () => {
    const veiculo = await createVehicle(t.app, owner, customerId, { plate: 'DSH6F78' });
    const order = await createWorkOrder(t.app, owner, {
      customerId,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId }],
    });
    await post(`/api/v1/work-orders/${order.id}/quotes`, {});
    const comOrcamento = await resumo();

    const cancelada = await post(`/api/v1/work-orders/${order.id}/cancel`, { reason: 'Cliente desistiu' });
    expect(cancelada.statusCode, cancelada.body).toBe(200);

    const depois = await resumo();
    expect(depois.approval.pending, 'não há mais o que o cliente responder').toBe(
      comOrcamento.approval.pending - 1,
    );
    const atencao = (await get('/api/v1/dashboard/attention')).json() as TestAttention;
    const esperando = atencao.groups.find((g) => g.key === 'QUOTES_WAITING');
    expect(esperando?.items.some((item) => item.to === `/ordens/${order.number}`)).toBeFalsy();
  });
});
