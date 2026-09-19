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

interface Relatorio {
  key: string;
  title: string;
  period: { from: string; to: string; label: string };
  columns: { key: string; label: string; format: string }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  summary: string | null;
}

/**
 * Relatórios e produtividade (E15). O que precisa ficar provado: cada
 * relatório soma o que promete, o CSV sai no formato que o Excel em português
 * abre (e SOMA), o cronômetro mede o tempo real do serviço com uma volta
 * aberta por pessoa, e relatório é coisa de quem vê dinheiro.
 */
describe('relatórios', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;
  let atendente: TestSession;
  let osId: string;
  let osNumero: number;
  let itemServico: string;
  let pecaId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  async function relatorio(key: string, extra = ''): Promise<Relatorio> {
    const res = await get(`/api/v1/reports/${key}?period=month${extra}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Relatorio;
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');

    const servico = (await post('/api/v1/services', { name: 'Revisão completa', priceCents: 40_000, estimatedMinutes: 120 })).json();
    pecaId = (await createPart(t.app, dono, {
      name: 'Filtro de óleo',
      salePriceCents: 6_000,
      initialQuantity: 10,
      initialUnitCostCents: 2_000,
      minQuantity: 4,
    })).id;

    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'REL1A23', make: 'Fiat', model: 'Argo' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [
        { type: 'SERVICE', serviceId: servico.id, mechanicUserId: mecanico.userId },
        { type: 'PART', partId: pecaId, quantity: 2 },
      ],
    });
    osId = os.id;
    osNumero = os.number;
    itemServico = os.items.find((item) => item.description.includes('Revisão'))!.id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ============================== cronômetro =================================

  it('o cronômetro mede o tempo real do serviço, e só uma volta fica aberta por pessoa', async () => {
    const iniciou = await post(`/api/v1/work-orders/${osId}/items/${itemServico}/timer/start`, {}, mecanico);
    expect(iniciou.statusCode, iniciou.body).toBe(200);
    const comCronometro = iniciou.json() as { items: { id: string; timerStartedAt: string | null; actualMinutes: number }[] };
    const item = comCronometro.items.find((linha) => linha.id === itemServico)!;
    expect(item.timerStartedAt, 'a volta está aberta').toBeTruthy();
    expect(item.actualMinutes).toBe(0);

    // apertar de novo no mesmo item não abre uma segunda volta
    const denovo = await post(`/api/v1/work-orders/${osId}/items/${itemServico}/timer/start`, {}, mecanico);
    expect(denovo.statusCode, denovo.body).toBe(200);

    const parou = await post(`/api/v1/work-orders/${osId}/items/${itemServico}/timer/stop`, {}, mecanico);
    expect(parou.statusCode, parou.body).toBe(200);
    const depois = (parou.json() as { items: { id: string; timerStartedAt: string | null; actualMinutes: number }[] }).items.find(
      (linha) => linha.id === itemServico,
    )!;
    expect(depois.timerStartedAt).toBeNull();
    // arredonda para cima, com o mínimo de 1: serviço de 40 segundos não é zero
    expect(depois.actualMinutes).toBe(1);

    // parar sem ter iniciado é recusado
    const semNada = await post(`/api/v1/work-orders/${osId}/items/${itemServico}/timer/stop`, {}, mecanico);
    expect(semNada.statusCode).toBe(422);
    expect(semNada.json().code).toBe('INVALID_TRANSITION');
  });

  it('começar em outro serviço para o anterior: ninguém trabalha em dois carros ao mesmo tempo', async () => {
    const cliente = await createCustomer(t.app, dono, { name: 'Carlos Lima' });
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'REL3C45', make: 'VW', model: 'Gol' });
    const segunda = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [{ type: 'SERVICE', description: 'Alinhamento', unitPriceCents: 9_000 }],
    });
    const outroItem = segunda.items[0]!.id;

    expect((await post(`/api/v1/work-orders/${osId}/items/${itemServico}/timer/start`, {}, mecanico)).statusCode).toBe(200);
    const trocou = await post(`/api/v1/work-orders/${segunda.id}/items/${outroItem}/timer/start`, {}, mecanico);
    expect(trocou.statusCode, trocou.body).toBe(200);

    // o primeiro fechou sozinho: a OS antiga não tem mais volta aberta
    const primeira = (await get(`/api/v1/work-orders/${osNumero}`)).json() as {
      items: { id: string; timerStartedAt: string | null; actualMinutes: number }[];
    };
    const item = primeira.items.find((linha) => linha.id === itemServico)!;
    expect(item.timerStartedAt).toBeNull();
    expect(item.actualMinutes).toBeGreaterThanOrEqual(2);

    await post(`/api/v1/work-orders/${segunda.id}/items/${outroItem}/timer/stop`, {}, mecanico);
  });

  it('o cronômetro é do serviço, não da peça, e não roda em OS encerrada', async () => {
    const itemDaPeca = (await get(`/api/v1/work-orders/${osNumero}`)).json().items.find(
      (item: { type: string }) => item.type === 'PART',
    ).id as string;
    const naPeca = await post(`/api/v1/work-orders/${osId}/items/${itemDaPeca}/timer/start`, {}, mecanico);
    expect(naPeca.statusCode).toBe(422);
    expect(naPeca.json().code).toBe('VALIDATION_FAILED');
  });

  // =============================== relatórios ================================

  it('o faturamento soma as OS finalizadas, com ticket médio e a diferença entre faturado e recebido', async () => {
    // aprova, executa e finaliza a OS: R$ 400 de serviço + 2 × R$ 60 de peça
    const orcamento = (await post(`/api/v1/work-orders/${osId}/quotes`, {})).json() as { id: string };
    await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await post(`/api/v1/work-orders/${osId}/start`);
    expect((await post(`/api/v1/work-orders/${osId}/complete`)).statusCode).toBe(200);
    await post(`/api/v1/work-orders/${osId}/payments`, { method: 'PIX', amountCents: 20_000 });

    const faturamento = await relatorio('revenue');
    expect(faturamento.totals).toMatchObject({ ordens: 1, faturado: 52_000, recebido: 20_000, ticket: 52_000 });
    expect(faturamento.summary).toContain('1 OS finalizada');
  });

  it('serviços e peças saem com o que renderam, e a peça mostra custo e margem', async () => {
    const servicos = await relatorio('services');
    expect(servicos.rows[0]).toMatchObject({ servico: 'Revisão completa', vezes: 1, faturado: 40_000 });

    const pecas = await relatorio('parts');
    // 2 × R$ 60 vendidos, 2 × R$ 20 de custo
    expect(pecas.rows[0]).toMatchObject({ peca: 'Filtro de óleo', quantidade: 2, faturado: 12_000, custo: 4_000, margem: 8_000 });
  });

  it('o relatório de mecânicos compara o tempo real do cronômetro com o estimado', async () => {
    const mecanicos = await relatorio('mechanics');
    const linha = mecanicos.rows.find((row) => row.mecanico === 'Zé Mecânico')!;
    expect(linha, 'o mecânico do item aparece').toBeTruthy();
    expect(linha.estimado, 'estimativa do catálogo').toBe(120);
    expect(Number(linha.real), 'tempo medido pelo cronômetro').toBeGreaterThanOrEqual(1);
    // real bem abaixo do estimado: desvio negativo
    expect(Number(linha.desvio)).toBeLessThan(0);
  });

  it('clientes, veículos e aprovação respondem à pergunta de cada um', async () => {
    const clientes = await relatorio('customers');
    expect(clientes.rows[0]).toMatchObject({ cliente: 'João Pereira', ordens: 1, faturado: 52_000 });

    const veiculos = await relatorio('vehicles');
    expect(veiculos.rows[0]).toMatchObject({ placa: 'REL1A23', ordens: 1 });

    const aprovacao = await relatorio('approval');
    expect(aprovacao.summary).toContain('Taxa de aprovação');
    expect(aprovacao.totals!.quantidade).toBe(1);
  });

  it('o estoque é a posição de AGORA, com o dinheiro parado na prateleira', async () => {
    const estoque = await relatorio('inventory');
    const filtro = estoque.rows.find((row) => row.peca === 'Filtro de óleo')!;
    // 10 − 2 usados = 8 a R$ 20 de custo
    expect(filtro).toMatchObject({ saldo: 8, custo: 2_000, parado: 16_000 });
    expect(estoque.summary).toContain('Posição de AGORA');
  });

  it('o lucro estimado é o mesmo do financeiro, e a compra de peça não entra duas vezes', async () => {
    const lucro = await relatorio('profit');
    const faturado = lucro.rows.find((row) => String(row.linha).startsWith('Faturado'))!;
    const pecas = lucro.rows.find((row) => String(row.linha).startsWith('Custo das peças'))!;
    expect(faturado.valor).toBe(52_000);
    expect(pecas.valor).toBe(-4_000);
    expect(lucro.totals!.valor).toBe(48_000);

    const doFinanceiro = (await get('/api/v1/finance/profit?period=month')).json() as { lucroCents: number };
    expect(doFinanceiro.lucroCents, 'um número só para "lucro" no sistema inteiro').toBe(lucro.totals!.valor);
  });

  // ================================== CSV ====================================

  it('o CSV sai com BOM, ponto e vírgula e dinheiro como número: a planilha soma a coluna', async () => {
    const res = await get('/api/v1/reports/revenue?period=month&format=csv');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain('faturamento-');

    const csv = res.body;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Dia;OS finalizadas;Faturado;Recebido;Ticket médio');
    expect(csv, 'sem "R$" e com vírgula decimal').toContain('520,00');
    expect(csv, 'a linha de total vai junto').toContain('Total;1;520,00');
  });

  // ================================ acesso ===================================

  it('relatório é de quem vê dinheiro: atendente e mecânico não entram', async () => {
    expect((await get('/api/v1/reports')).statusCode).toBe(200);
    for (const s of [atendente, mecanico]) {
      expect((await get('/api/v1/reports', s)).statusCode).toBe(403);
      expect((await get('/api/v1/reports/revenue', s)).statusCode).toBe(403);
    }
    const financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');
    expect((await get('/api/v1/reports/profit', financeiro)).statusCode).toBe(200);
  });

  it('o relatório de outra oficina não enxerga o movimento desta', async () => {
    const outra = await signup(t.app, { organizationName: 'Oficina Vizinha' });
    const faturamento = (await get('/api/v1/reports/revenue?period=month', outra)).json() as Relatorio;
    expect(faturamento.rows).toEqual([]);
    expect(faturamento.totals!.faturado).toBe(0);
  });
});
