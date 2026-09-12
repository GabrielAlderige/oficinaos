import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bearer, createPart, createTestApp, moveStock, signup, type TestApp, type TestSession } from './helpers';

describe('peças e estoque', () => {
  let t: TestApp;
  let owner: TestSession;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await signup(t.app);
  });
  afterAll(async () => {
    await t.app.close();
  });

  const get = (url: string, s: TestSession = owner) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const post = (url: string, payload: Record<string, unknown>, s: TestSession = owner) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload });

  describe('cadastro', () => {
    it('com estoque inicial vira movimento "estoque inicial" e define o custo', async () => {
      const part = await createPart(t.app, owner, { name: 'Filtro de óleo', initialQuantity: 10, initialUnitCostCents: 2000, salePriceCents: 3500 });
      expect(part).toMatchObject({ quantityOnHand: 10, averageCostCents: 2000, lastCostCents: 2000, stockStatus: 'OK', salePriceCents: 3500 });
      // margem padrão de 30% sobre o custo
      expect(part.suggestedPriceCents).toBe(2600);
      const movements = (await get(`/api/v1/parts/${part.id}/movements`)).json().data;
      expect(movements).toEqual([expect.objectContaining({ type: 'INITIAL', quantity: 10, balanceAfter: 10, unitCostCents: 2000 })]);
    });

    it('quantidade fracionada (óleo em litros) sem erro de arredondamento', async () => {
      const oil = await createPart(t.app, owner, { name: 'Óleo 5W30', unit: 'L', initialQuantity: 4.5, initialUnitCostCents: 4200 });
      expect(oil.quantityOnHand).toBe(4.5);
      const more = await moveStock(t.app, owner, { type: 'ENTRY', partId: oil.id, quantity: 0.3, unitCostCents: 4200 });
      expect(more.json().part.quantityOnHand).toBe(4.8);
    });

    it('recusa mais de 3 casas decimais e categoria de outra oficina', async () => {
      const decimals = await post('/api/v1/parts', { name: 'Fio', unit: 'M', initialQuantity: 1.2345 });
      expect(decimals.statusCode).toBe(400);
      const other = await signup(t.app);
      const foreignCategory = (await get('/api/v1/part-categories', other)).json().data[0].id;
      const res = await post('/api/v1/parts', { name: 'Peça X', categoryId: foreignCategory });
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0]).toMatchObject({ path: 'body.categoryId' });
    });

    it('código interno repetido (sem diferenciar maiúsculas) → 409', async () => {
      await createPart(t.app, owner, { name: 'Vela', sku: 'VL-01' });
      const dup = await post('/api/v1/parts', { name: 'Outra vela', sku: 'vl-01' });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({ code: 'PART_SKU_TAKEN', errors: [{ path: 'body.sku' }] });
    });
  });

  describe('busca por palavra, com aplicação', () => {
    let org: TestSession;

    beforeAll(async () => {
      org = await signup(t.app);
      const categories = (await get('/api/v1/part-categories', org)).json().data;
      const freios = categories.find((c: { name: string }) => c.name === 'Freios').id;
      const pastilhaGol = await createPart(t.app, org, { name: 'Pastilha de freio dianteira', manufacturer: 'Cobreq', manufacturerCode: 'N-1234', categoryId: freios });
      await post(`/api/v1/parts/${pastilhaGol.id}/applications`, { make: 'Volkswagen', model: 'Gol', engine: '1.0', yearFrom: 2008, yearTo: 2016 }, org);
      const pastilhaAstra = await createPart(t.app, org, { name: 'Pastilha de freio', manufacturer: 'Bosch', manufacturerCode: 'BP-976', categoryId: freios });
      await post(`/api/v1/parts/${pastilhaAstra.id}/applications`, { make: 'Chevrolet', model: 'Astra', engine: '2.0', yearFrom: 1999, yearTo: 2011 }, org);
      await createPart(t.app, org, { name: 'Filtro de ar', manufacturer: 'Tecfil' });
    });

    const names = async (q: string) =>
      (await get(`/api/v1/parts?q=${encodeURIComponent(q)}`, org)).json().data.map((p: { name: string }) => p.name).sort();

    it('"pastilha de freio astra 2.0 2002" (exemplo do briefing) acha só a do Astra', async () => {
      expect(await names('pastilha de freio astra 2.0 2002')).toEqual(['Pastilha de freio']);
    });

    it('o ano precisa estar na faixa da aplicação', async () => {
      expect(await names('pastilha gol 2012')).toEqual(['Pastilha de freio dianteira']);
      expect(await names('pastilha gol 2020')).toEqual([]);
    });

    it('acha por código do fabricante, marca da peça e sem acento', async () => {
      expect(await names('N-1234')).toEqual(['Pastilha de freio dianteira']);
      expect(await names('bosch')).toEqual(['Pastilha de freio']);
      expect(await names('pastilha')).toEqual(['Pastilha de freio', 'Pastilha de freio dianteira']);
    });

    it('aplicação com ano final antes do inicial é recusada', async () => {
      const part = await createPart(t.app, org, { name: 'Disco' });
      const res = await post(`/api/v1/parts/${part.id}/applications`, { make: 'Fiat', yearFrom: 2015, yearTo: 2010 }, org);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors[0].path).toBe('body.yearTo');
    });
  });

  describe('movimentos de estoque', () => {
    it('entrada recalcula o custo médio móvel', async () => {
      const part = await createPart(t.app, owner, { name: 'Pastilha média', initialQuantity: 10, initialUnitCostCents: 1000 });
      const res = await moveStock(t.app, owner, { type: 'ENTRY', partId: part.id, quantity: 10, unitCostCents: 2000 });
      expect(res.statusCode).toBe(201);
      expect(res.json().part).toMatchObject({ quantityOnHand: 20, averageCostCents: 1500, lastCostCents: 2000 });
      expect(res.json().movement).toMatchObject({ type: 'MANUAL_IN', quantity: 10, balanceAfter: 20 });
    });

    it('entrada sem custo soma quantidade e mantém o custo médio', async () => {
      const part = await createPart(t.app, owner, { name: 'Abraçadeira', initialQuantity: 5, initialUnitCostCents: 300 });
      const res = await moveStock(t.app, owner, { type: 'ENTRY', partId: part.id, quantity: 5 });
      expect(res.json().part).toMatchObject({ quantityOnHand: 10, averageCostCents: 300 });
    });

    it('ajuste de contagem exige motivo e registra a diferença (inclusive negativa)', async () => {
      const part = await createPart(t.app, owner, { name: 'Lâmpada H4', initialQuantity: 20, initialUnitCostCents: 1500 });
      const noReason = await moveStock(t.app, owner, { type: 'ADJUSTMENT', partId: part.id, countedQuantity: 18 });
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json().errors[0].path).toBe('body.reason');

      const ok = await moveStock(t.app, owner, { type: 'ADJUSTMENT', partId: part.id, countedQuantity: 18, reason: 'Contagem mensal' });
      expect(ok.json().movement).toMatchObject({ type: 'ADJUSTMENT', quantity: -2, balanceAfter: 18, reason: 'Contagem mensal' });

      const same = await moveStock(t.app, owner, { type: 'ADJUSTMENT', partId: part.id, countedQuantity: 18, reason: 'De novo' });
      expect(same.statusCode).toBe(422);
      expect(same.json().code).toBe('STOCK_NO_CHANGE');
    });

    it('peça sem controle de estoque não movimenta', async () => {
      const part = await createPart(t.app, owner, { name: 'Serviço de solda (terceiro)', trackStock: false });
      const res = await moveStock(t.app, owner, { type: 'ENTRY', partId: part.id, quantity: 1 });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('STOCK_NOT_TRACKED');
    });

    it('entradas simultâneas não se perdem (a peça fica travada durante o movimento)', async () => {
      const part = await createPart(t.app, owner, { name: 'Parafuso de roda' });
      const results = await Promise.all(
        Array.from({ length: 8 }, () => moveStock(t.app, owner, { type: 'ENTRY', partId: part.id, quantity: 1 })),
      );
      expect(results.every((r) => r.statusCode === 201)).toBe(true);
      expect((await get(`/api/v1/parts/${part.id}`)).json().quantityOnHand).toBe(8);
      const balances = (await get(`/api/v1/parts/${part.id}/movements`)).json().data.map((m: { balanceAfter: number }) => m.balanceAfter);
      expect(balances.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('situação e resumo: abaixo do mínimo, sem estoque e valor ao custo', async () => {
      const s = await signup(t.app);
      await createPart(t.app, s, { name: 'Ok', initialQuantity: 10, initialUnitCostCents: 100, minQuantity: 2 });
      const low = await createPart(t.app, s, { name: 'Baixo', initialQuantity: 3, initialUnitCostCents: 1000, minQuantity: 5 });
      const out = await createPart(t.app, s, { name: 'Zerado', minQuantity: 1 });
      expect(low.stockStatus).toBe('LOW');
      expect(out.stockStatus).toBe('OUT');

      const attention = (await get('/api/v1/parts?stock=attention', s)).json().data.map((p: { name: string }) => p.name).sort();
      expect(attention).toEqual(['Baixo', 'Zerado']);
      expect((await get('/api/v1/inventory/summary', s)).json()).toEqual({
        trackedParts: 3,
        low: 1,
        out: 1,
        negative: 0,
        stockValueCents: 10 * 100 + 3 * 1000,
      });
    });
  });

  describe('permissões e isolamento', () => {
    it('mecânico e atendente não veem custo nem margem; financeiro vê', async () => {
      const part = await createPart(t.app, owner, { name: 'Correia', initialQuantity: 2, initialUnitCostCents: 8000, markupBps: 5000 });
      for (const role of ['MECHANIC', 'ATTENDANT'] as const) {
        const member = await addMember(t.app, owner, role);
        const seen = (await get(`/api/v1/parts/${part.id}`, member)).json();
        expect(seen, role).toMatchObject({ costHidden: true, averageCostCents: null, lastCostCents: null, markupBps: null, suggestedPriceCents: null });
        const movements = (await get(`/api/v1/parts/${part.id}/movements`, member)).json().data;
        expect(movements[0].unitCostCents, role).toBeNull();
        expect((await get('/api/v1/inventory/summary', member)).json().stockValueCents, role).toBeNull();
      }
      const finance = await addMember(t.app, owner, 'FINANCE');
      expect((await get(`/api/v1/parts/${part.id}`, finance)).json()).toMatchObject({ costHidden: false, averageCostCents: 8000, suggestedPriceCents: 12000 });
    });

    it('só gerente para cima movimenta estoque e cadastra peça', async () => {
      const part = await createPart(t.app, owner, { name: 'Junta' });
      const attendant = await addMember(t.app, owner, 'ATTENDANT');
      expect((await moveStock(t.app, attendant, { type: 'ENTRY', partId: part.id, quantity: 1 })).statusCode).toBe(403);
      expect((await post('/api/v1/parts', { name: 'Nova' }, attendant)).statusCode).toBe(403);
      const manager = await addMember(t.app, owner, 'MANAGER');
      expect((await moveStock(t.app, manager, { type: 'ENTRY', partId: part.id, quantity: 1 })).statusCode).toBe(201);
    });

    it('outra oficina não vê, não movimenta e não aplica (404)', async () => {
      const part = await createPart(t.app, owner, { name: 'Peça da oficina A', initialQuantity: 1 });
      const other = await signup(t.app);
      expect((await get(`/api/v1/parts/${part.id}`, other)).statusCode).toBe(404);
      expect((await moveStock(t.app, other, { type: 'ENTRY', partId: part.id, quantity: 5 })).statusCode).toBe(404);
      expect((await post(`/api/v1/parts/${part.id}/applications`, { make: 'VW' }, other)).statusCode).toBe(404);
      expect((await get(`/api/v1/parts/${part.id}`)).json().quantityOnHand).toBe(1);
    });
  });
});
