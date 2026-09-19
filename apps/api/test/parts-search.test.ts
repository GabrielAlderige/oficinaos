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

interface Oferta {
  id: string;
  provider: string;
  isMock: boolean;
  title: string;
  brand: string | null;
  code: string | null;
  priceCents: number;
  shippingCents: number;
  totalCents: number;
  availability: string;
  leadTimeDays: number | null;
  supplierName: string | null;
  partId: string | null;
  availableQuantity: number | null;
  suggestedPriceCents: number;
  priceGapCents: number;
  badges: string[];
}

interface Resultado {
  queryId: string;
  markupBps: number;
  offers: Oferta[];
  providers: { provider: string; ok: boolean; count: number; isMock: boolean }[];
}

/**
 * Pesquisa de peças e comparador (E14). O que precisa ficar provado: cada
 * provider traz o que é dele (estoque, lista importada, cotação respondida), o
 * comparador escolhe pelo custo TOTAL e pelo prazo, a planilha torta importa o
 * que dá e diz o que recusou, a oferta vira item da OS pelo preço com margem —
 * e preço de peça é custo, então o atendente não vê.
 */
describe('pesquisa de peças', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let gerente: TestSession;
  let fornecedorRapido: string;
  let fornecedorBarato: string;
  let pastilhaId: string;
  let osId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  async function buscar(q: string, s: TestSession = dono, extra: Record<string, unknown> = {}) {
    const res = await post('/api/v1/parts-search', { q, ...extra }, s);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Resultado;
  }

  const importar = (supplierId: string, csv: string, extra: Record<string, unknown> = {}, s: TestSession = dono) =>
    post(`/api/v1/suppliers/${supplierId}/price-list`, { csv, ...extra }, s);

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    gerente = await addMember(t.app, dono, 'MANAGER', 'Gil Gerente');

    fornecedorRapido = (await post('/api/v1/suppliers', { name: 'Central Autopeças', leadTimeDays: 1 })).json().id;
    fornecedorBarato = (await post('/api/v1/suppliers', { name: 'Distribuidora Paulista', leadTimeDays: 10 })).json().id;

    // peça no estoque da oficina: custo médio R$ 100, 4 unidades
    pastilhaId = (
      await createPart(t.app, dono, {
        name: 'Pastilha de freio dianteira',
        manufacturer: 'Bosch',
        manufacturerCode: 'PF-100',
        initialQuantity: 4,
        initialUnitCostCents: 10_000,
        salePriceCents: 18_000,
      })
    ).id;

    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira' });
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'PSQ1A23', make: 'Fiat', model: 'Argo' });
    const servico = await post('/api/v1/services', { name: 'Troca de pastilhas', priceCents: 12_000 });
    osId = (
      await createWorkOrder(t.app, dono, {
        customerId: cliente.id,
        vehicleId: carro.id,
        items: [{ type: 'SERVICE', serviceId: servico.json().id }],
      })
    ).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ============================== providers ==================================

  it('acha a peça do estoque pelo nome, com prazo zero e o custo médio', async () => {
    const resultado = await buscar('pastilha');
    const doEstoque = resultado.offers.find((oferta) => oferta.provider === 'internal');
    expect(doEstoque, 'a peça do catálogo aparece').toBeTruthy();
    expect(doEstoque).toMatchObject({
      title: 'Pastilha de freio dianteira',
      brand: 'Bosch',
      code: 'PF-100',
      priceCents: 10_000,
      shippingCents: 0,
      availability: 'IN_STOCK',
      leadTimeDays: 0,
      partId: pastilhaId,
      availableQuantity: 4,
    });
    // margem padrão de 30%: R$ 100 de custo → R$ 130 sugeridos
    expect(doEstoque!.suggestedPriceCents).toBe(13_000);
    expect(resultado.markupBps).toBe(3_000);
  });

  it('o provider falso vem desligado: nenhuma oferta de demonstração sem pedir', async () => {
    const resultado = await buscar('pastilha');
    expect(resultado.offers.some((oferta) => oferta.isMock)).toBe(false);
    expect(resultado.providers.map((p) => p.provider)).toEqual(['internal', 'price_list', 'rfq']);
  });

  it('a lista de preço importada vira oferta, com o prazo do fornecedor', async () => {
    const csv = [
      'Código;Descrição;Marca;Preço;Unidade',
      'PF-200;Pastilha de freio dianteira cerâmica;Fras-le;"189,90";PC',
      'DT-10;Disco de freio ventilado;Bosch;R$ 245,00;PC',
      ';Sem código mas com preço;Generic;99,00;PC',
    ].join('\n');
    const res = await importar(fornecedorBarato, csv);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ imported: 3, updated: 0, skipped: 0, removed: 0 });

    const resultado = await buscar('pastilha');
    const daLista = resultado.offers.find((oferta) => oferta.provider === 'price_list');
    expect(daLista).toMatchObject({
      title: 'Pastilha de freio dianteira cerâmica',
      brand: 'Fras-le',
      code: 'PF-200',
      priceCents: 18_990,
      availability: 'TO_ORDER',
      leadTimeDays: 10,
      supplierName: 'Distribuidora Paulista',
    });
  });

  it('importar de novo atualiza pelo código, e "trocar a lista" remove o que saiu', async () => {
    const atualizada = 'codigo;descricao;preco\nPF-200;Pastilha de freio dianteira cerâmica;179,90';
    const segunda = await importar(fornecedorBarato, atualizada);
    expect(segunda.statusCode, segunda.body).toBe(201);
    expect(segunda.json()).toMatchObject({ imported: 0, updated: 1 });

    const lista = await get(`/api/v1/suppliers/${fornecedorBarato}/price-list?pageSize=100`);
    expect(lista.statusCode, lista.body).toBe(200);
    const corpo = lista.json() as { itemCount: number; items: { code: string | null; priceCents: number }[] };
    expect(corpo.itemCount, 'as três linhas continuam lá').toBe(3);
    expect(corpo.items.find((item) => item.code === 'PF-200')!.priceCents).toBe(17_990);

    // agora trocando a lista inteira: só o que veio nesta importação sobra
    const troca = await importar(fornecedorBarato, atualizada, { replace: true });
    expect(troca.json()).toMatchObject({ updated: 1, removed: 2 });
    const depois = await get(`/api/v1/suppliers/${fornecedorBarato}/price-list?pageSize=100`);
    expect(depois.json().itemCount).toBe(1);

    // e devolve a lista para os próximos cenários
    await importar(fornecedorBarato, 'codigo;descricao;marca;preco\nPF-200;Pastilha de freio dianteira cerâmica;Fras-le;189,90');
  });

  it('planilha torta importa o que dá e diz, com o número da linha, o que recusou', async () => {
    const csv = [
      'codigo;descricao;preco',
      'OK-1;Filtro de óleo;39,90',
      'X-2;;19,90',
      'X-3;Correia dentada;sob consulta',
      'X-4;Bico injetor;R$ 1.299,00',
    ].join('\n');
    const res = await importar(fornecedorRapido, csv);
    expect(res.statusCode, res.body).toBe(201);
    const corpo = res.json() as { imported: number; skipped: number; problems: { line: number; reason: string }[] };
    expect(corpo.imported).toBe(2);
    expect(corpo.skipped).toBe(2);
    // a linha 1 é o cabeçalho: a descrição vazia está na 3 da planilha
    expect(corpo.problems).toEqual([
      { line: 3, reason: 'sem descrição' },
      { line: 4, reason: 'preço inválido: "sob consulta"' },
    ]);
  });

  it('a cotação respondida (E11) também vira oferta, com marca e prazo do fornecedor', async () => {
    const maria = await createCustomer(t.app, dono, { name: 'Maria Souza' });
    const uno = await createVehicle(t.app, dono, maria.id, { plate: 'PSQ2B34', make: 'Fiat', model: 'Uno' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: maria.id,
      vehicleId: uno.id,
      items: [{ type: 'PART', partId: pastilhaId, quantity: 2, sourcing: 'TO_ORDER' }],
    });
    const itemId = os.items[0]!.id;
    const cotacao = await post('/api/v1/supplier-quotes', {
      workOrderId: os.id,
      workOrderItemIds: [itemId],
      supplierIds: [fornecedorRapido],
    });
    expect(cotacao.statusCode, cotacao.body).toBe(201);
    const { links } = cotacao.json() as { links: { supplierId: string; link: string }[] };
    const token = links[0]!.link.slice(links[0]!.link.lastIndexOf('/') + 1);

    const tela = await t.app.inject({ method: 'GET', url: `/api/v1/public/supplier-quotes/${token}`, remoteAddress: nextIp() });
    expect(tela.statusCode, tela.body).toBe(200);
    const publica = tela.json() as { contentHash: string; items: { id: string }[] };
    const respondeu = await t.app.inject({
      method: 'POST',
      url: `/api/v1/public/supplier-quotes/${token}/responses`,
      remoteAddress: nextIp(),
      payload: {
        contentHash: publica.contentHash,
        responderName: 'Roberto',
        shippingCents: 0,
        items: publica.items.map((item) => ({
          requestItemId: item.id,
          availability: 'AVAILABLE',
          unitPriceCents: 9_500,
          brand: 'TRW',
          leadTimeDays: 1,
        })),
      },
    });
    expect(respondeu.statusCode, respondeu.body).toBe(200);

    const resultado = await buscar('pastilha');
    const daCotacao = resultado.offers.find((oferta) => oferta.provider === 'rfq');
    expect(daCotacao).toMatchObject({
      priceCents: 9_500,
      brand: 'TRW',
      leadTimeDays: 1,
      supplierName: 'Central Autopeças',
      availability: 'TO_ORDER',
    });
  });

  // ============================== comparador =================================

  it('os três selos saem pela regra: total, prazo e o custo com a espera', async () => {
    const resultado = await buscar('pastilha');
    const porSelo = (selo: string) => resultado.offers.find((oferta) => oferta.badges.includes(selo));

    // estoque: R$ 100 e pronta entrega; cotação: R$ 95 em 1 dia; lista: R$ 189,90 em 10 dias
    expect(porSelo('best_price')!.priceCents, 'a mais barata no total').toBe(9_500);
    expect(porSelo('fastest')!.availability, 'prazo zero é o estoque').toBe('IN_STOCK');
    // 9.500 × 1,02 = 9.690 contra 10.000 do estoque: a cotação ainda ganha
    expect(porSelo('best_value')!.priceCents).toBe(9_500);

    // a lista sai da mais barata para a mais cara, e a diferença é para a mais barata
    expect(resultado.offers[0]!.priceGapCents).toBe(0);
    expect(resultado.offers.at(-1)!.priceGapCents).toBeGreaterThan(0);
  });

  it('a busca fica gravada e pode ser reaberta pelo identificador', async () => {
    const resultado = await buscar('pastilha');
    const denovo = await get(`/api/v1/parts-search/${resultado.queryId}`);
    expect(denovo.statusCode, denovo.body).toBe(200);
    expect((denovo.json() as Resultado).offers.length).toBe(resultado.offers.length);
  });

  // ============================ adicionar à OS ===============================

  it('a oferta vira item da OS pelo preço com margem, e o estoque entra como "do estoque"', async () => {
    const resultado = await buscar('pastilha');
    const doEstoque = resultado.offers.find((oferta) => oferta.provider === 'internal')!;

    const res = await post(`/api/v1/parts-search/offers/${doEstoque.id}/add-to-work-order`, {
      workOrderId: osId,
      quantity: 2,
    });
    expect(res.statusCode, res.body).toBe(201);
    const os = res.json() as { items: { type: string; partId: string | null; unitPriceCents: number; sourcing: string }[] };
    const item = os.items.find((linha) => linha.partId === pastilhaId)!;
    expect(item).toMatchObject({ type: 'PART', unitPriceCents: 13_000, sourcing: 'STOCK' });

    // e uma oferta de fornecedor entra como "comprar", com o preço que eu mandar
    const daLista = resultado.offers.find((oferta) => oferta.provider === 'price_list')!;
    const segunda = await post(`/api/v1/parts-search/offers/${daLista.id}/add-to-work-order`, {
      workOrderId: osId,
      quantity: 1,
      unitPriceCents: 29_900,
      isOptional: true,
    });
    expect(segunda.statusCode, segunda.body).toBe(201);
    const depois = segunda.json() as { items: { description: string; unitPriceCents: number; sourcing: string; isOptional: boolean }[] };
    const comprada = depois.items.find((linha) => linha.description.includes('cerâmica'))!;
    expect(comprada).toMatchObject({ unitPriceCents: 29_900, sourcing: 'TO_ORDER', isOptional: true });
  });

  // ============================== acesso =====================================

  it('preço de peça é custo: o atendente não pesquisa, o gerente sim', async () => {
    expect((await post('/api/v1/parts-search', { q: 'pastilha' }, atendente)).statusCode).toBe(403);
    expect((await get(`/api/v1/suppliers/${fornecedorRapido}/price-list`, atendente)).statusCode).toBe(403);

    const doGerente = await post('/api/v1/parts-search', { q: 'pastilha' }, gerente);
    expect(doGerente.statusCode, doGerente.body).toBe(200);

    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    expect((await post('/api/v1/parts-search', { q: 'pastilha' }, mecanico)).statusCode).toBe(403);
  });

  it('a lista de preço de outra oficina não existe para esta', async () => {
    const outra = await signup(t.app, { organizationName: 'Oficina Vizinha' });
    const dela = (await post('/api/v1/suppliers', { name: 'Fornecedor da vizinha' }, outra)).json().id as string;
    await importar(dela, 'codigo;descricao;preco\nZZ-1;Pastilha exclusiva da vizinha;10,00', {}, outra);

    const minha = await buscar('pastilha');
    expect(minha.offers.some((oferta) => oferta.title.includes('vizinha'))).toBe(false);
    expect((await get(`/api/v1/suppliers/${dela}/price-list`)).statusCode).toBe(404);
    expect((await importar(dela, 'codigo;descricao;preco\nX;Y;1,00')).statusCode).toBe(404);
  });
});
