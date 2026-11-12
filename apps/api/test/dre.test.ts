import { randomUUID } from 'node:crypto';
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

interface Linha {
  key: string;
  label: string;
  kind: 'grupo' | 'item' | 'resultado';
  parent: string | null;
  amountCents: number;
}

/** O dia NA OFICINA (o relatório usa o fuso dela; depois das 21 h o UTC já é amanhã). */
const hojeNaOficina = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const mesPassado = () => {
  const [ano, mes] = hojeNaOficina().split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(ano, mes - 2, 15));
  return d.toISOString().slice(0, 10);
};

/**
 * DRE por competência (E51). O que precisa ficar provado com o banco de verdade:
 *
 * - a OS finalizada entra no mês mesmo SEM o cliente ter pago, separada em serviço e peça;
 * - a comissão é a da OS finalizada no mês, não a paga ao mecânico;
 * - a despesa entra pela competência (a de outro mês fica fora, paga ou não);
 * - a compra de peças não desconta duas vezes;
 * - os impostos são CALCULADOS pelo regime (aqui, Presumido com ISS de 5%);
 * - sem regime e com CNPJ, a Receita é consultada e o regime fica gravado.
 */
describe('DRE por competência', () => {
  let t: TestApp;
  let dono: TestSession;
  let linhas: Linha[];

  const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, s: TestSession = dono) =>
    t.app.inject({ method, url, headers: bearer(s.accessToken), ...(payload === undefined ? {} : { payload: payload as never }) });
  const valor = (key: string) => linhas.find((linha) => linha.key === key)?.amountCents;

  async function categoria(direction: 'PAYABLE' | 'RECEIVABLE', systemKey: string) {
    const lista = (await req('GET', `/api/v1/finance/categories?direction=${direction}`)).json().data as {
      id: string;
      systemKey: string | null;
    }[];
    return lista.find((c) => c.systemKey === systemKey)!.id;
  }

  async function lancar(direction: 'PAYABLE' | 'RECEIVABLE', systemKey: string, description: string, amountCents: number, extra = {}) {
    const res = await req('POST', '/api/v1/finance/entries', {
      direction,
      categoryId: await categoria(direction, systemKey),
      description,
      amountCents,
      dueDate: hojeNaOficina(),
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data[0].id as string;
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Bruno');
    expect((await req('PATCH', '/api/v1/organization/settings', { commissionBps: 1000 })).statusCode).toBe(200);
    const fiscal = await req('PUT', '/api/v1/fiscal-settings', { taxRegime: 'LUCRO_PRESUMIDO', issRateBps: 500 });
    expect(fiscal.statusCode, fiscal.body).toBe(200);

    // OS: serviço de R$ 1.000 + filtro de R$ 500 (custo R$ 300), finalizada e NÃO paga
    const servico = (await req('POST', '/api/v1/services', { name: 'Revisão', priceCents: 100_000 })).json().id as string;
    const filtro = (await createPart(t.app, dono, { name: 'Filtro', salePriceCents: 50_000, initialQuantity: 5, initialUnitCostCents: 30_000 })).id;
    const cliente = await createCustomer(t.app, dono, { name: 'Maria Souza' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'DRE1A23' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      mechanicUserId: mecanico.userId,
      items: [
        { type: 'SERVICE', serviceId: servico },
        { type: 'PART', partId: filtro, quantity: 1 },
      ],
    });
    const orcamento = (await req('POST', `/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
    await req('POST', `/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    await req('POST', `/api/v1/work-orders/${os.id}/start`);
    const fim = await req('POST', `/api/v1/work-orders/${os.id}/complete`);
    expect(fim.statusCode, fim.body).toBe(200);

    // balcão: 2 baterias a R$ 500 (custo R$ 300 cada)
    const bateria = (await createPart(t.app, dono, { name: 'Bateria 60Ah', salePriceCents: 50_000, initialQuantity: 5, initialUnitCostCents: 30_000 })).id;
    const venda = await req('POST', '/api/v1/counter-sales', {
      clientRequestId: randomUUID(),
      items: [{ partId: bateria, quantity: 2, unitPriceCents: 50_000 }],
      payment: { kind: 'PAID', method: 'PIX' },
    });
    expect(venda.statusCode, venda.body).toBe(201);

    await lancar('PAYABLE', 'RENT', 'Aluguel deste mês (ainda não pago)', 20_000);
    await lancar('PAYABLE', 'RENT', 'Aluguel do mês passado, vencendo hoje', 20_000, { competenceDate: mesPassado() });
    await lancar('PAYABLE', 'PARTS', 'Compra de baterias', 60_000);
    await lancar('PAYABLE', 'TAXES', 'Guia do imposto do mês', 6_000);
    await lancar('PAYABLE', 'FEES', 'Alvará de funcionamento', 3_000);
    await lancar('RECEIVABLE', 'OTHER_INCOME', 'Aluguel do box', 5_000);

    const res = await req('GET', '/api/v1/finance/dre?period=month');
    expect(res.statusCode, res.body).toBe(200);
    linhas = res.json().lines;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('a receita é a da OS finalizada (paga ou não), separada em serviço e peça, mais o balcão', () => {
    expect(valor('receita_servicos')).toBe(100_000);
    expect(valor('receita_pecas')).toBe(50_000);
    expect(valor('receita_balcao')).toBe(100_000);
    expect(valor('receita_bruta')).toBe(250_000);
  });

  it('os impostos são calculados pelo regime (Presumido, ISS 5%, peça com ICMS-ST)', () => {
    expect(valor('iss'), '5% do serviço').toBe(-5_000);
    expect(valor('pis'), '0,65% da receita').toBe(-1_625);
    expect(valor('cofins'), '3% da receita').toBe(-7_500);
    expect(valor('icms')).toBe(0);
    expect(valor('deducoes')).toBe(-14_125);
    // IRPJ: (32% de 1.000 + 8% de 1.500) × 15%; CSLL: (32% de 1.000 + 12% de 1.500) × 9%
    expect(valor('irpj')).toBe(-6_600);
    expect(valor('csll')).toBe(-4_500);
  });

  it('custo da peça que saiu e comissão da OS do mês (10% do serviço), mesmo sem pagar o mecânico', () => {
    expect(valor('custo_pecas'), 'filtro R$ 300 + 2 baterias R$ 600').toBe(-90_000);
    expect(valor('comissoes')).toBe(-10_000);
  });

  it('despesa por competência: a deste mês entra sem estar paga; a do mês passado fica fora; compra de peça não entra', () => {
    expect(valor('despesas_operacionais'), 'aluguel deste mês + alvará').toBe(-23_000);
    expect(linhas.map((l) => l.label)).not.toContain('Peças e insumos');
    expect(valor('outras_receitas'), 'lançamento avulso a receber').toBe(5_000);
  });

  it('a guia de imposto paga não vira despesa: o imposto já está calculado nas deduções', () => {
    expect(linhas.some((l) => l.label.startsWith('Impostos'))).toBe(false);
    expect(linhas.find((l) => l.label === 'Taxas, alvará e IPTU')?.amountCents).toBe(-3_000);
  });

  it('desce até o lucro líquido, com cada grupo somando os seus itens', () => {
    expect(valor('resultado_antes_ir')).toBe(250_000 - 14_125 - 100_000 - 23_000 + 5_000);
    expect(valor('lucro_liquido')).toBe(117_875 - 11_100);
    for (const grupo of linhas.filter((l) => l.kind === 'grupo')) {
      const soma = linhas.filter((l) => l.parent === grupo.key).reduce((s, l) => s + l.amountCents, 0);
      expect(grupo.amountCents, grupo.label).toBe(soma);
    }
  });

  it('a despesa do mês passado aparece no mês passado', async () => {
    const dias = mesPassado();
    const de = `${dias.slice(0, 8)}01`;
    const res = await req('GET', `/api/v1/finance/dre?period=custom&from=${de}&to=${dias}`);
    expect(res.json().lines.find((l: Linha) => l.key === 'despesas_operacionais').amountCents).toBe(-20_000);
  });

  it('o mecânico não vê a DRE', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Outro');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/finance/dre', headers: bearer(mecanico.accessToken) });
    expect(res.statusCode).toBe(403);
  });
});

describe('regime pelo CNPJ', () => {
  let t: TestApp;
  let dono: TestSession;
  const consultas: string[] = [];

  beforeAll(async () => {
    t = await createTestApp(
      {},
      {
        consultaCnpj: async (cnpj) => {
          consultas.push(cnpj);
          return { regime: 'SIMPLES_NACIONAL', detail: 'Optante pelo Simples Nacional desde 01/01/2020, segundo a Receita' };
        },
      },
    );
    dono = await signup(t.app);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string) => t.app.inject({ method: 'GET', url, headers: bearer(dono.accessToken) });

  it('sem CNPJ no cadastro, não consulta nada e a DRE avisa que falta o regime', async () => {
    const dre = (await get('/api/v1/finance/dre')).json();
    expect(consultas).toEqual([]);
    expect(dre.regime.regime).toBeNull();
    expect(dre.regime.avisos.join(' ')).toMatch(/regime/);
  });

  it('com CNPJ e sem regime, a DRE consulta a Receita, grava o regime e já calcula com ele', async () => {
    const org = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: { document: '11.222.333/0001-81' },
    });
    expect(org.statusCode, org.body).toBe(200);

    const dre = (await get('/api/v1/finance/dre')).json();
    expect(consultas).toEqual(['11222333000181']);
    expect(dre.regime).toMatchObject({ regime: 'SIMPLES_NACIONAL', source: 'RECEITA' });
    expect(dre.lines.map((l: Linha) => l.key)).toContain('cpp');

    // já tem regime: abrir a DRE de novo não consulta outra vez
    await get('/api/v1/finance/dre');
    expect(consultas).toHaveLength(1);
  });

  it('escolher o regime à mão marca a origem como manual; o botão consulta de novo quando pedem', async () => {
    const manual = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/fiscal-settings',
      headers: bearer(dono.accessToken),
      payload: { taxRegime: 'LUCRO_PRESUMIDO' },
    });
    expect(manual.json()).toMatchObject({ taxRegime: 'LUCRO_PRESUMIDO', taxRegimeSource: 'MANUAL' });

    const botao = await t.app.inject({ method: 'POST', url: '/api/v1/fiscal-settings/regime-lookup', headers: bearer(dono.accessToken) });
    expect(botao.statusCode, botao.body).toBe(200);
    expect(botao.json()).toMatchObject({ result: 'ATUALIZADO', settings: { taxRegime: 'SIMPLES_NACIONAL', taxRegimeSource: 'RECEITA' } });
  });
});
