import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
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
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

interface Link {
  inviteId: string;
  supplierId: string;
  supplierName: string;
  link: string;
  whatsappUrl: string | null;
}
interface Offer {
  id: string;
  requestItemId: string;
  availability: string;
  unitPriceCents: number | null;
  leadTimeDays: number | null;
}
interface Quote {
  id: string;
  number: number;
  status: string;
  pricesHidden: boolean;
  items: {
    id: string;
    description: string;
    award: { responseItemId: string } | null;
    cheapestResponseItemId: string | null;
    pricing: { markupBps: number; workOrderUnitPriceCents: number | null; workOrderItemDraft: boolean } | null;
  }[];
  invites: {
    id: string;
    supplier: { id: string; name: string };
    versions: number;
    viewCount: number;
    response: { version: number; shippingCents: number | null; items: Offer[] } | null;
  }[];
  summaries: { supplierId: string; totalCents: number }[];
}
interface Publica {
  state: string;
  answerable: boolean;
  contentHash: string;
  supplierName: string;
  vehicle: Record<string, unknown> | null;
  items: { id: string; description: string }[];
  lastResponse: { version: number; items: { unitPriceCents: number | null }[] } | null;
}

const PLACA = 'COT1A23';
const CHASSI = '9BWAB45U0KT000001';
const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');
const tokenDe = (link: string) => link.slice(link.lastIndexOf('/') + 1);

/**
 * Cotação com fornecedores por link (E11). O que precisa ficar provado, pela
 * API, é o que a oficina e o fornecedor não podem descobrir por acidente: o
 * fornecedor não vê o cliente, a placa, nem o preço do outro; o atendente não vê
 * preço; ninguém escolhe uma oferta velha; e o link morto não abre nada.
 */
describe('cotação com fornecedores', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let mecanico: TestSession;
  let financeiro: TestSession;
  let osId: string;
  let itemPastilha: string;
  let itemDisco: string;
  let itemServico: string;
  let fornecedorA: string;
  let fornecedorB: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) => t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  // o fornecedor não tem login: cada chamada pública vem de um IP próprio, como no celular dele
  const abrir = (token: string) =>
    t.app.inject({ method: 'GET', url: `/api/v1/public/supplier-quotes/${token}`, remoteAddress: nextIp() });
  const responder = (token: string, payload: unknown) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/public/supplier-quotes/${token}/responses`,
      payload: payload as never,
      remoteAddress: nextIp(),
      headers: { 'user-agent': 'Celular do Roberto' },
    });

  async function fornecedor(nome: string, s: TestSession = dono) {
    const res = await post('/api/v1/suppliers', { name: nome, whatsapp: '(11) 97777-0000' }, s);
    expect(res.statusCode, res.body).toBe(201);
    return res.json().id as string;
  }

  async function cotar(extra: Record<string, unknown> = {}, s: TestSession = dono) {
    const res = await post(
      '/api/v1/supplier-quotes',
      { workOrderId: osId, workOrderItemIds: [itemPastilha, itemDisco], supplierIds: [fornecedorA, fornecedorB], ...extra },
      s,
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as { quote: Quote; links: Link[] };
  }

  const linkDe = (links: Link[], supplierId: string) => tokenDe(links.find((l) => l.supplierId === supplierId)!.link);

  /** A resposta completa de um fornecedor: preço por peça, na mesma ordem da tela. */
  const resposta = (tela: Publica, precos: (number | null)[], extra: Record<string, unknown> = {}) => ({
    contentHash: tela.contentHash,
    responderName: 'Roberto',
    shippingCents: 1500,
    items: tela.items.map((item, i) => ({
      requestItemId: item.id,
      availability: precos[i] === null ? 'UNAVAILABLE' : 'AVAILABLE',
      unitPriceCents: precos[i],
      leadTimeDays: 2,
    })),
    ...extra,
  });

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    financeiro = await addMember(t.app, dono, 'FINANCE', 'Fábio Financeiro');

    const cliente = await createCustomer(t.app, dono, { name: 'Maria Cliente Sigilosa', whatsapp: '(11) 98888-1111' });
    const carro = await createVehicle(t.app, dono, cliente.id, {
      plate: PLACA,
      vin: CHASSI,
      make: 'Volkswagen',
      model: 'Gol',
      version: '1.6 MSI',
      engine: 'EA211',
      yearModel: 2019,
    });
    const pastilha = await createPart(t.app, dono, { name: 'Pastilha dianteira', manufacturerCode: 'PS-9' });
    const disco = await createPart(t.app, dono, { name: 'Disco ventilado', manufacturerCode: 'DF-1' });
    const servico = await post('/api/v1/services', { name: 'Troca de pastilhas', priceCents: 18000 });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [
        { type: 'PART', partId: pastilha.id, quantity: 1, unitPriceCents: 25000 },
        { type: 'PART', partId: disco.id, quantity: 2, unitPriceCents: 31000 },
        { type: 'SERVICE', serviceId: servico.json().id },
      ],
    });
    osId = os.id;
    itemPastilha = os.items.find((i) => i.description.includes('Pastilha'))!.id;
    itemDisco = os.items.find((i) => i.description.includes('Disco'))!.id;
    itemServico = os.items.find((i) => i.description.includes('Troca'))!.id;
    fornecedorA = await fornecedor('Central Autopeças');
    fornecedorB = await fornecedor('Distribuidora Paulista');
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ================================ criar ====================================

  it('cria a cotação e devolve um link por fornecedor, que o banco guarda só como hash', async () => {
    const { quote, links } = await cotar();
    expect(quote.status).toBe('OPEN');
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.whatsappUrl?.startsWith('https://wa.me/'))).toBe(true);

    const { db } = testDb();
    const { rows } = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ token_hash: string }>(sql`select token_hash from supplier_quote_invites where request_id = ${quote.id}`),
    );
    const hashes = rows.map((r) => r.token_hash).sort();
    expect(hashes).toEqual(links.map((l) => sha256(tokenDe(l.link))).sort());
    // e o token em texto não aparece em lugar nenhum da tabela
    expect(JSON.stringify(rows)).not.toContain(tokenDe(links[0]!.link));
  });

  it('só peça entra na cotação, e só peça DESTA OS', async () => {
    const comServico = await post('/api/v1/supplier-quotes', {
      workOrderId: osId,
      workOrderItemIds: [itemServico],
      supplierIds: [fornecedorA],
    });
    expect(comServico.statusCode, comServico.body).toBe(400);
    expect(comServico.json().errors[0].message).toBe('Só peças entram na cotação');

    const outroCliente = await createCustomer(t.app, dono, { name: 'Outro' });
    const outroCarro = await createVehicle(t.app, dono, outroCliente.id, { plate: 'OUT9Z99' });
    const outraPeca = await createPart(t.app, dono, { name: 'Filtro' });
    const outraOs = await createWorkOrder(t.app, dono, {
      customerId: outroCliente.id,
      vehicleId: outroCarro.id,
      items: [{ type: 'PART', partId: outraPeca.id, quantity: 1, unitPriceCents: 5000 }],
    });
    const deOutraOs = await post('/api/v1/supplier-quotes', {
      workOrderId: osId,
      workOrderItemIds: [outraOs.items[0]!.id],
      supplierIds: [fornecedorA],
    });
    expect(deOutraOs.statusCode, deOutraOs.body).toBe(400);
    expect(deOutraOs.json().errors[0].message).toBe('Peça não encontrada nesta OS');
  });

  it('atendente pede cotação; mecânico não', async () => {
    const res = await post(
      '/api/v1/supplier-quotes',
      { workOrderId: osId, workOrderItemIds: [itemPastilha], supplierIds: [fornecedorA] },
      atendente,
    );
    expect(res.statusCode, res.body).toBe(201);
    const doMecanico = await post(
      '/api/v1/supplier-quotes',
      { workOrderId: osId, workOrderItemIds: [itemPastilha], supplierIds: [fornecedorA] },
      mecanico,
    );
    expect(doMecanico.statusCode).toBe(403);
  });

  it('fornecedor de outra oficina não entra na cotação', async () => {
    const vizinha = await signup(t.app);
    const deFora = await fornecedor('Fornecedor Da Vizinha', vizinha);
    const res = await post('/api/v1/supplier-quotes', { workOrderId: osId, workOrderItemIds: [itemPastilha], supplierIds: [deFora] });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().errors[0].message).toBe('Fornecedor não encontrado');

    // e o que a própria oficina tirou da lista também não
    const apagado = await fornecedor('Tirado Antes De Cotar');
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v1/suppliers/${apagado}`, headers: bearer(dono.accessToken) })).statusCode).toBe(204);
    const comApagado = await post('/api/v1/supplier-quotes', { workOrderId: osId, workOrderItemIds: [itemPastilha], supplierIds: [apagado] });
    expect(comApagado.statusCode, comApagado.body).toBe(400);
    expect(comApagado.json().errors[0].message).toBe('Fornecedor não encontrado');
  });

  // ======================= o que o fornecedor vê ==========================

  it('o fornecedor vê as peças e o carro, mas nunca a placa nem o cliente da oficina', async () => {
    const { links } = await cotar();
    const res = await abrir(linkDe(links, fornecedorA));
    expect(res.statusCode, res.body).toBe(200);
    const tela = res.json() as Publica;
    expect(tela.supplierName).toBe('Central Autopeças');
    expect(tela.items.map((i) => i.description).sort()).toEqual(['Disco ventilado', 'Pastilha dianteira']);
    expect(tela.vehicle).toMatchObject({ make: 'Volkswagen', model: 'Gol', year: 2019, engine: 'EA211' });

    // o corpo INTEIRO, não só um campo: nada da placa, do cliente nem do telefone dele
    expect(res.body).not.toContain(PLACA);
    expect(res.body).not.toContain('Maria Cliente Sigilosa');
    expect(res.body).not.toContain('988881111');
    // e o chassi também não, porque a oficina não marcou
    expect(res.body).not.toContain(CHASSI);
  });

  it('o chassi só vai quando a oficina marca "incluir chassi"', async () => {
    const { links } = await cotar({ includeVin: true });
    const res = await abrir(linkDe(links, fornecedorA));
    expect((res.json() as Publica).vehicle?.vin).toBe(CHASSI);
    expect(res.body).not.toContain(PLACA);
  });

  it('um fornecedor nunca vê a resposta do outro', async () => {
    const { links } = await cotar();
    const tokenA = linkDe(links, fornecedorA);
    const tokenB = linkDe(links, fornecedorB);
    const telaB = (await abrir(tokenB)).json() as Publica;
    const respB = await responder(tokenB, resposta(telaB, [73519, 43217]));
    expect(respB.statusCode, respB.body).toBe(200);

    const telaA = await abrir(tokenA);
    expect((telaA.json() as Publica).lastResponse).toBeNull();
    expect(telaA.body).not.toContain('73519');
    expect(telaA.body).not.toContain('43217');
    expect(telaA.body).not.toContain('Distribuidora Paulista');
  });

  it('link inventado ou torto não abre nada', async () => {
    expect((await abrir('A'.repeat(43))).statusCode).toBe(404);
    expect((await abrir('curto-demais-para-ser-token')).statusCode).toBe(404);
  });

  // ============================== responder ==================================

  it('responde, corrige, e a oficina vê a correção com a última versão valendo', async () => {
    const { quote, links } = await cotar();
    const token = linkDe(links, fornecedorA);
    const tela = (await abrir(token)).json() as Publica;

    const primeira = await responder(token, resposta(tela, [20000, 30000]));
    expect(primeira.statusCode, primeira.body).toBe(200);
    const corrigida = await responder(token, resposta(tela, [18000, 30000]));
    expect(corrigida.statusCode, corrigida.body).toBe(200);
    expect((corrigida.json() as Publica).lastResponse?.version).toBe(2);

    const naOficina = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const convite = naOficina.invites.find((c) => c.supplier.id === fornecedorA)!;
    expect(convite.versions, 'a oficina sabe que houve correção').toBe(2);
    const precos = convite.response!.items.map((o) => o.unitPriceCents).sort();
    expect(precos, 'vale a última').toEqual([18000, 30000]);
    expect(convite.viewCount).toBeGreaterThanOrEqual(1);

    // a versão 1 continua no banco: é prova, não se apaga
    const { db } = testDb();
    const { rows } = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ version: number; ip: string | null; user_agent: string | null }>(
        sql`select version, ip, user_agent from supplier_quote_responses where invite_id = ${convite.id} order by version`,
      ),
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0]!.user_agent, 'fica de que aparelho veio').toBe('Celular do Roberto');
  });

  it('a resposta chega na linha do tempo da OS e no sino da oficina, sem preço', async () => {
    const { links } = await cotar();
    const token = linkDe(links, fornecedorA);
    const tela = (await abrir(token)).json() as Publica;
    expect((await responder(token, resposta(tela, [61937, 52841]))).statusCode).toBe(200);

    const linha = await get(`/api/v1/work-orders/${osId}/timeline`, atendente);
    const eventos = linha.json().data as { type: string }[];
    expect(eventos.some((e) => e.type === 'SUPPLIER_QUOTE_ANSWERED')).toBe(true);
    const sino = await get('/api/v1/notifications', atendente);
    expect(sino.body).toContain('SUPPLIER_QUOTE_ANSWERED');
    for (const corpo of [linha.body, sino.body]) {
      expect(corpo).not.toContain('61937');
      expect(corpo).not.toContain('619,37');
      expect(corpo).not.toContain('52841');
      expect(corpo).not.toContain('528,41');
    }
    // mecânico não pede cotação, então não é avisado
    const doMecanico = await get('/api/v1/notifications', mecanico);
    expect(doMecanico.body).not.toContain('SUPPLIER_QUOTE_ANSWERED');
  });

  it('toda peça precisa de resposta, e só as peças desta cotação', async () => {
    const { links } = await cotar();
    const token = linkDe(links, fornecedorA);
    const tela = (await abrir(token)).json() as Publica;

    const faltando = resposta(tela, [100, 200]);
    faltando.items = faltando.items.slice(0, 1);
    const r1 = await responder(token, faltando);
    expect(r1.statusCode, r1.body).toBe(400);
    expect(r1.json().errors[0].message).toContain('Responda todas as peças');

    const sobrando = resposta(tela, [100, 200]);
    sobrando.items = [...sobrando.items.slice(0, 1), { ...sobrando.items[1]!, requestItemId: '01a09c30-ca23-758e-8590-30c069903c7b' }];
    const r2 = await responder(token, sobrando);
    expect(r2.statusCode, r2.body).toBe(400);
  });

  it('resposta para outro conteúdo é recusada', async () => {
    const { links } = await cotar();
    const token = linkDe(links, fornecedorA);
    const tela = (await abrir(token)).json() as Publica;
    const res = await responder(token, resposta(tela, [100, 200], { contentHash: 'b'.repeat(64) }));
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe('SUPPLIER_QUOTE_OUTDATED');
  });

  it('vencida, cancelada ou com fornecedor fora da lista não aceita resposta', async () => {
    // vencida
    const vencida = await cotar();
    const tokenV = linkDe(vencida.links, fornecedorA);
    const telaV = (await abrir(tokenV)).json() as Publica;
    const { db } = testDb();
    await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(sql`update supplier_quote_requests set expires_at = now() - interval '1 minute' where id = ${vencida.quote.id}`),
    );
    const r1 = await responder(tokenV, resposta(telaV, [100, 200]));
    expect(r1.statusCode, r1.body).toBe(422);
    expect(r1.json().detail).toBe('O prazo para responder esta cotação acabou.');
    expect(((await abrir(tokenV)).json() as Publica).state).toBe('EXPIRED');

    // cancelada
    const cancelada = await cotar();
    const tokenC = linkDe(cancelada.links, fornecedorA);
    const telaC = (await abrir(tokenC)).json() as Publica;
    expect((await post(`/api/v1/supplier-quotes/${cancelada.quote.id}/cancel`, { reason: 'Cliente desistiu' })).statusCode).toBe(200);
    const r2 = await responder(tokenC, resposta(telaC, [100, 200]));
    expect(r2.statusCode, r2.body).toBe(422);
    expect(r2.json().detail).toBe('A oficina cancelou esta cotação.');

    // fornecedor tirado da lista: o link morre
    const tirado = await fornecedor('Vai Sair Da Lista');
    const comTirado = await cotar({ supplierIds: [tirado] });
    const tokenT = linkDe(comTirado.links, tirado);
    expect((await t.app.inject({ method: 'DELETE', url: `/api/v1/suppliers/${tirado}`, headers: bearer(dono.accessToken) })).statusCode).toBe(204);
    expect((await abrir(tokenT)).statusCode).toBe(404);
  });

  it('reenviar o link mata o antigo na hora', async () => {
    const { quote, links } = await cotar();
    const antigo = linkDe(links, fornecedorA);
    const convite = links.find((l) => l.supplierId === fornecedorA)!;
    const reenvio = await post(`/api/v1/supplier-quotes/${quote.id}/invites/${convite.inviteId}/reissue`);
    expect(reenvio.statusCode, reenvio.body).toBe(200);
    const novo = tokenDe(reenvio.json().link as string);
    expect(novo).not.toBe(antigo);
    expect((await abrir(antigo)).statusCode, 'o link antigo não abre mais').toBe(404);
    expect((await abrir(novo)).statusCode).toBe(200);
  });

  // ======================= o que a oficina vê =============================

  it('o atendente acompanha quem respondeu, mas não vê preço, frete, total nem o mais barato', async () => {
    const { quote, links } = await cotar();
    for (const [supplierId, precos] of [
      [fornecedorA, [20000, 30000]],
      [fornecedorB, [19000, 35000]],
    ] as const) {
      const token = linkDe(links, supplierId);
      const tela = (await abrir(token)).json() as Publica;
      expect((await responder(token, resposta(tela, [...precos]))).statusCode).toBe(200);
    }

    const res = await get(`/api/v1/supplier-quotes/${quote.id}`, atendente);
    expect(res.statusCode, res.body).toBe(200);
    const doAtendente = res.json() as Quote;
    expect(doAtendente.pricesHidden).toBe(true);
    expect(doAtendente.invites.every((c) => c.response !== null), 'vê que responderam').toBe(true);
    expect(doAtendente.summaries).toEqual([]);
    expect(doAtendente.items.every((i) => i.cheapestResponseItemId === null)).toBe(true);
    // margem e preço de venda da OS também são informação de custo
    expect(doAtendente.items.every((i) => i.pricing === null)).toBe(true);
    for (const convite of doAtendente.invites) {
      expect(convite.response!.shippingCents).toBeNull();
      expect(convite.response!.items.every((o) => o.unitPriceCents === null)).toBe(true);
    }
    // o corpo inteiro: nenhum dos preços escapa por outro campo
    for (const preco of ['20000', '30000', '19000', '35000']) expect(res.body).not.toContain(preco);

    // o financeiro, que vê custo, vê tudo
    const doFinanceiro = (await get(`/api/v1/supplier-quotes/${quote.id}`, financeiro)).json() as Quote;
    expect(doFinanceiro.pricesHidden).toBe(false);
    expect(doFinanceiro.summaries).toHaveLength(2);
    expect(doFinanceiro.items.some((i) => i.cheapestResponseItemId !== null)).toBe(true);
    // a peça sem margem própria usa a da oficina (30%); o preço é o de hoje na OS
    expect(doFinanceiro.items.find((i) => i.description === 'Pastilha dianteira')!.pricing).toEqual({
      markupBps: 3000,
      workOrderUnitPriceCents: 25000,
      workOrderItemDraft: true,
    });
  });

  // =============================== escolher ==================================

  it('escolher encerra a cotação, grava o histórico de preço e o custo no item em rascunho', async () => {
    const { quote, links } = await cotar();
    const tokenA = linkDe(links, fornecedorA);
    const tokenB = linkDe(links, fornecedorB);
    const telaA = (await abrir(tokenA)).json() as Publica;
    await responder(tokenA, resposta(telaA, [20000, 30000]));
    const telaB = (await abrir(tokenB)).json() as Publica;
    await responder(tokenB, resposta(telaB, [19000, null]));

    const antes = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const pastilha = antes.items.find((i) => i.description === 'Pastilha dianteira')!;
    const ofertaB = antes.invites.find((c) => c.supplier.id === fornecedorB)!.response!.items.find((o) => o.requestItemId === pastilha.id)!;

    // o atendente não escolhe
    expect((await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: pastilha.id, responseItemId: ofertaB.id }] }, atendente)).statusCode).toBe(403);

    const escolha = await post(`/api/v1/supplier-quotes/${quote.id}/award`, {
      awards: [{ requestItemId: pastilha.id, responseItemId: ofertaB.id }],
    });
    expect(escolha.statusCode, escolha.body).toBe(200);
    const depois = escolha.json() as Quote;
    expect(depois.status).toBe('CLOSED');
    expect(depois.items.find((i) => i.id === pastilha.id)!.award?.responseItemId).toBe(ofertaB.id);

    const { db } = testDb();
    const historico = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ price_cents: string; source: string }>(
        sql`select price_cents, source from part_price_history where supplier_quote_request_id = ${quote.id} order by price_cents`,
      ),
    );
    // todas as ofertas válidas: 19000 (B pastilha), 20000 e 30000 (A); o "não tenho" de B fica de fora
    expect(historico.rows.map((r) => Number(r.price_cents))).toEqual([19000, 20000, 30000]);
    expect(historico.rows.every((r) => r.source === 'RFQ')).toBe(true);

    const custo = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ unit_cost_cents: string | null }>(sql`select unit_cost_cents from work_order_items where id = ${itemPastilha}`),
    );
    expect(Number(custo.rows[0]!.unit_cost_cents), 'o custo do vencedor entra no item em rascunho').toBe(19000);

    // encerrada: o fornecedor não reenvia mais
    const tardia = await responder(tokenA, resposta(telaA, [15000, 30000]));
    expect(tardia.statusCode, tardia.body).toBe(422);
    expect(tardia.json().detail).toBe('A oficina já escolheu as ofertas desta cotação.');
  });

  it('não dá para escolher oferta velha, "não tenho", nem oferta de outra peça', async () => {
    const { quote, links } = await cotar();
    const token = linkDe(links, fornecedorA);
    const tela = (await abrir(token)).json() as Publica;
    await responder(token, resposta(tela, [20000, null]));
    const v1 = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const ofertasV1 = v1.invites.find((c) => c.supplier.id === fornecedorA)!.response!.items;
    await responder(token, resposta(tela, [18000, null]));

    const pastilha = v1.items.find((i) => i.description === 'Pastilha dianteira')!;
    const disco = v1.items.find((i) => i.description === 'Disco ventilado')!;
    const velha = ofertasV1.find((o) => o.requestItemId === pastilha.id)!;

    const r1 = await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: pastilha.id, responseItemId: velha.id }] });
    expect(r1.statusCode, 'a versão 1 foi corrigida: não vale mais').toBe(400);
    expect(r1.json().errors[0].message).toBe('Oferta inválida para esta peça');

    const v2 = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const nova = v2.invites.find((c) => c.supplier.id === fornecedorA)!.response!.items;
    const naoTemV2 = nova.find((o) => o.requestItemId === disco.id)!;
    const r2 = await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: disco.id, responseItemId: naoTemV2.id }] });
    expect(r2.statusCode, '"não tenho" não se escolhe').toBe(400);

    const pastilhaV2 = nova.find((o) => o.requestItemId === pastilha.id)!;
    const r3 = await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: disco.id, responseItemId: pastilhaV2.id }] });
    expect(r3.statusCode, 'oferta da pastilha não serve para o disco').toBe(400);
  });

  it('item que já foi no orçamento para o cliente não tem o custo mexido', async () => {
    const cliente = await createCustomer(t.app, dono, { name: 'Cliente Com Orçamento' });
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'ORC2B34' });
    const peca = await createPart(t.app, dono, { name: 'Amortecedor' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [{ type: 'PART', partId: peca.id, quantity: 1, unitPriceCents: 40000 }],
    });
    // o orçamento sai: o item deixa de ser rascunho
    expect((await post(`/api/v1/work-orders/${os.id}/quotes`, {})).statusCode).toBe(201);

    const { db } = testDb();
    const antes = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ unit_cost_cents: string | null }>(sql`select unit_cost_cents from work_order_items where id = ${os.items[0]!.id}`),
    );

    const criada = await post('/api/v1/supplier-quotes', {
      workOrderId: os.id,
      workOrderItemIds: [os.items[0]!.id],
      supplierIds: [fornecedorA],
    });
    const { quote, links } = criada.json() as { quote: Quote; links: Link[] };
    const token = tokenDe(links[0]!.link);
    const tela = (await abrir(token)).json() as Publica;
    await responder(token, resposta(tela, [21000]));
    const aberta = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const oferta = aberta.invites[0]!.response!.items[0]!;
    const escolha = await post(`/api/v1/supplier-quotes/${quote.id}/award`, {
      awards: [{ requestItemId: oferta.requestItemId, responseItemId: oferta.id }],
    });
    expect(escolha.statusCode, escolha.body).toBe(200);

    const custo = await withTenant(db, { organizationId: dono.orgId }, (tx) =>
      tx.execute<{ unit_cost_cents: string | null; approval_status: string }>(
        sql`select unit_cost_cents, approval_status from work_order_items where id = ${os.items[0]!.id}`,
      ),
    );
    expect(custo.rows[0]!.approval_status, 'o item já não é rascunho').not.toBe('DRAFT');
    expect(custo.rows[0]!.unit_cost_cents, 'o custo continua o de antes').toBe(antes.rows[0]!.unit_cost_cents);
    expect(Number(custo.rows[0]!.unit_cost_cents)).not.toBe(21000);
  });

  it('trocar a escolha de uma peça mantém uma escolha só e atualiza o custo', async () => {
    const { quote, links } = await cotar({ workOrderItemIds: [itemDisco] });
    for (const [supplierId, preco] of [
      [fornecedorA, 30500],
      [fornecedorB, 29500],
    ] as const) {
      const token = linkDe(links, supplierId);
      const tela = (await abrir(token)).json() as Publica;
      expect((await responder(token, resposta(tela, [preco]))).statusCode).toBe(200);
    }
    const aberta = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    const requestItemId = aberta.items[0]!.id;
    const ofertaDe = (supplierId: string) => aberta.invites.find((c) => c.supplier.id === supplierId)!.response!.items[0]!.id;

    expect((await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId, responseItemId: ofertaDe(fornecedorA) }] })).statusCode).toBe(200);
    const troca = await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId, responseItemId: ofertaDe(fornecedorB) }] });
    expect(troca.statusCode, troca.body).toBe(200);
    expect((troca.json() as Quote).items[0]!.award?.responseItemId).toBe(ofertaDe(fornecedorB));

    const { db } = testDb();
    const linhas = await withTenant(db, { organizationId: dono.orgId }, async (tx) => ({
      escolhas: await tx.execute(sql`select 1 from supplier_quote_awards where request_item_id = ${requestItemId}`),
      custo: await tx.execute<{ unit_cost_cents: string }>(sql`select unit_cost_cents from work_order_items where id = ${itemDisco}`),
      historico: await tx.execute(sql`select 1 from part_price_history where supplier_quote_request_id = ${quote.id}`),
    }));
    expect(linhas.escolhas.rows).toHaveLength(1);
    expect(Number(linhas.custo.rows[0]!.unit_cost_cents)).toBe(29500);
    expect(linhas.historico.rows, 'o histórico é gravado uma vez, no encerramento').toHaveLength(2);
  });

  // ============================== cancelamento ================================

  it('cancelar a OS cancela a cotação aberta', async () => {
    const cliente = await createCustomer(t.app, dono, { name: 'Cliente Que Desistiu' });
    const carro = await createVehicle(t.app, dono, cliente.id, { plate: 'DES3C45' });
    const peca = await createPart(t.app, dono, { name: 'Correia' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: carro.id,
      items: [{ type: 'PART', partId: peca.id, quantity: 1, unitPriceCents: 19000 }],
    });
    const criada = await post('/api/v1/supplier-quotes', { workOrderId: os.id, workOrderItemIds: [os.items[0]!.id], supplierIds: [fornecedorA] });
    const { quote, links } = criada.json() as { quote: Quote; links: Link[] };

    expect((await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' })).statusCode).toBe(200);
    const depois = (await get(`/api/v1/supplier-quotes/${quote.id}`)).json() as Quote;
    expect(depois.status).toBe('CANCELED');
    expect(((await abrir(tokenDe(links[0]!.link))).json() as Publica).answerable).toBe(false);

    // e numa OS cancelada não se abre cotação nova
    const nova = await post('/api/v1/supplier-quotes', { workOrderId: os.id, workOrderItemIds: [os.items[0]!.id], supplierIds: [fornecedorA] });
    expect(nova.statusCode, nova.body).toBe(422);
  });

  // =============================== isolamento =================================

  it('oficina de fora não vê, não escolhe e não reenvia: 404', async () => {
    const { quote, links } = await cotar();
    const vizinha = await signup(t.app);
    expect((await get(`/api/v1/supplier-quotes/${quote.id}`, vizinha)).statusCode).toBe(404);
    expect((await post(`/api/v1/supplier-quotes/${quote.id}/award`, { awards: [{ requestItemId: quote.items[0]!.id, responseItemId: quote.items[0]!.id }] }, vizinha)).statusCode).toBe(404);
    expect((await post(`/api/v1/supplier-quotes/${quote.id}/invites/${links[0]!.inviteId}/reissue`, {}, vizinha)).statusCode).toBe(404);
    expect((await post(`/api/v1/supplier-quotes/${quote.id}/cancel`, { reason: 'Não é minha' }, vizinha)).statusCode).toBe(404);
  });
});
