import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bearer, createPart, createTestApp, signup, type TestApp, type TestSession } from './helpers';

interface Linha {
  key: string;
  label: string;
  amountCents: number;
}

/**
 * DRE (E49). O que precisa ficar provado: as linhas descem da receita ao
 * resultado com os números de verdade do banco (balcão, custo da peça,
 * imposto, comissão, aluguel), a compra de peças não desconta duas vezes, e o
 * resultado é o MESMO número do lucro estimado e do relatório.
 */
describe('DRE', () => {
  let t: TestApp;
  let dono: TestSession;
  let linhas: Linha[];

  const req = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: bearer(dono.accessToken), ...(payload === undefined ? {} : { payload: payload as never }) });
  const valor = (key: string) => linhas.find((linha) => linha.key === key)?.amountCents;

  async function despesaPaga(systemKey: string, descricao: string, amountCents: number) {
    const categorias = (await req('GET', '/api/v1/finance/categories?direction=PAYABLE')).json().data as {
      id: string;
      systemKey: string | null;
    }[];
    const categoria = categorias.find((c) => c.systemKey === systemKey)!;
    const hoje = new Date().toISOString().slice(0, 10);
    const criada = await req('POST', '/api/v1/finance/entries', {
      direction: 'PAYABLE',
      categoryId: categoria.id,
      description: descricao,
      amountCents,
      dueDate: hoje,
    });
    expect(criada.statusCode, criada.body).toBe(201);
    const id = criada.json().data[0].id as string;
    const baixa = await req('POST', `/api/v1/finance/entries/${id}/settlements`, {
      clientRequestId: randomUUID(),
      amountCents,
      method: 'PIX',
    });
    expect(baixa.statusCode, baixa.body).toBe(201);
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Bruno');
    const peca = (
      await createPart(t.app, dono, { name: 'Bateria 60Ah', salePriceCents: 50_000, initialQuantity: 5, initialUnitCostCents: 30_000 })
    ).id;
    const venda = await req('POST', '/api/v1/counter-sales', {
      clientRequestId: randomUUID(),
      items: [{ partId: peca, quantity: 2, unitPriceCents: 50_000 }],
      payment: { kind: 'PAID', method: 'PIX' },
    });
    expect(venda.statusCode, venda.body).toBe(201);
    await despesaPaga('TAXES', 'DAS do mês', 6_000);
    await despesaPaga('RENT', 'Aluguel', 20_000);
    await despesaPaga('PARTS', 'Compra de baterias', 60_000);
    const hoje = new Date().toISOString().slice(0, 10);
    const comissao = await req('POST', '/api/v1/commissions/payouts', {
      mechanicUserId: mecanico.userId,
      periodFrom: hoje,
      periodTo: hoje,
      amountCents: 4_000,
    });
    expect(comissao.statusCode, comissao.body).toBe(201);

    const res = await req('GET', '/api/v1/finance/dre?period=month');
    expect(res.statusCode, res.body).toBe(200);
    linhas = res.json().lines;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('desce da receita ao resultado com os números do banco', () => {
    expect(valor('receita_balcao'), '2 baterias a R$ 500').toBe(100_000);
    expect(valor('receita_bruta')).toBe(100_000);
    expect(valor('impostos')).toBe(-6_000);
    expect(valor('custo_pecas'), '2 baterias a R$ 300 de custo').toBe(-60_000);
    expect(valor('comissoes')).toBe(-4_000);
    expect(valor('lucro_bruto')).toBe(30_000);
    expect(valor('despesas_operacionais')).toBe(-20_000);
    expect(valor('resultado')).toBe(10_000);
  });

  it('a compra de peças não aparece: a bateria já descontou pelo custo da que saiu', () => {
    expect(linhas.map((linha) => linha.label)).not.toContain('Peças e insumos');
  });

  it('o resultado é o mesmo número do lucro estimado', async () => {
    const lucro = (await req('GET', '/api/v1/finance/profit?period=month')).json();
    expect(lucro.lucroCents).toBe(valor('resultado'));
    expect(lucro.despesasPorCategoria.map((d: { name: string }) => d.name)).toContain('Comissões dos mecânicos');
  });

  it('o mecânico não vê a DRE', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Outro');
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/finance/dre', headers: bearer(mecanico.accessToken) });
    expect(res.statusCode).toBe(403);
  });
});
