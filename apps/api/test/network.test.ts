import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, bearer, createPart, createTestApp, signup, type TestApp, type TestSession } from './helpers';

/**
 * Várias unidades (E50).
 *
 * O que precisa ficar provado: a unidade nova nasce com o catálogo copiado e
 * SEM estoque; a transferência tira do disponível de uma e põe na outra pelo
 * mesmo custo, e é atômica (uma peça impossível desfaz a transferência
 * inteira); o painel soma as unidades; e só dono/administrador das duas
 * pontas mexe — o gerente não vê a rede, e oficina de fora não é destino.
 */
describe('várias unidades', () => {
  let t: TestApp;
  let dono: TestSession;
  let unidade2: string;
  let tokenNa2: string;
  let filtro: string;
  let semEstoque: string;

  const req = (method: 'GET' | 'POST', url: string, payload?: unknown, token = dono.accessToken) =>
    t.app.inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload: payload as never }) });
  const saldoNa = async (token: string, nome: string) => {
    const lista = (await req('GET', `/api/v1/parts?q=${encodeURIComponent(nome)}`, undefined, token)).json().data as {
      name: string;
      quantityOnHand: number;
    }[];
    return lista.find((p) => p.name === nome)?.quantityOnHand;
  };

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    await req('POST', '/api/v1/services', { name: 'Alinhamento', priceCents: 9_000 });
    filtro = (await createPart(t.app, dono, { name: 'Filtro de ar', sku: 'FA-01', salePriceCents: 6_500, initialQuantity: 10, initialUnitCostCents: 2_000 })).id;
    semEstoque = (await createPart(t.app, dono, { name: 'Fita isolante', trackStock: false, salePriceCents: 500 })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('abre a unidade nova com o catálogo copiado e sem estoque', async () => {
    const res = await req('POST', '/api/v1/network/units', { name: 'Oficina Centro', copyCatalog: true });
    expect(res.statusCode, res.body).toBe(201);
    unidade2 = res.json().id;

    const trocou = await req('POST', '/api/v1/auth/switch-organization', { organizationId: unidade2 });
    expect(trocou.statusCode, trocou.body).toBe(200);
    expect(trocou.json().me).toMatchObject({ role: 'OWNER', organization: { name: 'Oficina Centro' } });
    tokenNa2 = trocou.json().accessToken;

    const servicos = (await req('GET', '/api/v1/services', undefined, tokenNa2)).json().data as { name: string }[];
    expect(servicos.map((s) => s.name)).toContain('Alinhamento');
    expect(await saldoNa(tokenNa2, 'Filtro de ar'), 'o catálogo vem, o estoque não').toBe(0);
  });

  it('transfere pelo mesmo custo, tirando só do disponível', async () => {
    const res = await req('POST', '/api/v1/network/transfers', { toOrganizationId: unidade2, items: [{ partId: filtro, quantity: 3 }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().items).toEqual([{ name: 'Filtro de ar', quantity: 3, createdAtDestination: false }]);
    expect(await saldoNa(dono.accessToken, 'Filtro de ar')).toBe(7);
    expect(await saldoNa(tokenNa2, 'Filtro de ar')).toBe(3);

    const naOutra = (await req('GET', '/api/v1/parts?q=Filtro', undefined, tokenNa2)).json().data[0];
    const ficha = (await req('GET', `/api/v1/parts/${naOutra.id}`, undefined, tokenNa2)).json();
    expect(ficha.averageCostCents, 'entra pelo custo da origem').toBe(2_000);
  });

  it('é atômica: uma peça impossível desfaz a transferência inteira', async () => {
    const res = await req('POST', '/api/v1/network/transfers', {
      toOrganizationId: unidade2,
      items: [
        { partId: filtro, quantity: 1 },
        { partId: semEstoque, quantity: 1 },
      ],
    });
    expect(res.statusCode).toBe(422);
    expect(await saldoNa(dono.accessToken, 'Filtro de ar'), 'o filtro não saiu').toBe(7);
    expect(await saldoNa(tokenNa2, 'Filtro de ar')).toBe(3);

    const demais = await req('POST', '/api/v1/network/transfers', { toOrganizationId: unidade2, items: [{ partId: filtro, quantity: 50 }] });
    expect(demais.statusCode).toBe(422);
    expect(demais.json().title).toBe('Quantidade acima do disponível');
  });

  it('o painel da rede mostra as duas unidades e o total', async () => {
    const res = await req('GET', '/api/v1/network?period=month');
    expect(res.statusCode, res.body).toBe(200);
    const painel = res.json();
    expect(painel.units.map((u: { name: string }) => u.name).sort()).toEqual(['Oficina Centro', 'Oficina Teste'].sort());
    // estoque ao custo médio: 7 × R$ 20 aqui + 3 × R$ 20 lá
    expect(painel.totals.stockValueCents).toBe(20_000);
  });

  it('só dono ou administrador das duas pontas: o gerente não vê a rede, e oficina de fora não é destino', async () => {
    const gerente = await addMember(t.app, dono, 'MANAGER', 'Gerente');
    expect((await req('GET', '/api/v1/network', undefined, gerente.accessToken)).statusCode).toBe(403);

    const estranha = await signup(t.app);
    const res = await req('POST', '/api/v1/network/transfers', { toOrganizationId: estranha.orgId, items: [{ partId: filtro, quantity: 1 }] });
    expect(res.statusCode).toBe(404);
    expect(await saldoNa(dono.accessToken, 'Filtro de ar')).toBe(7);
  });
});
