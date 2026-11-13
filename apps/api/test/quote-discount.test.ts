import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import {
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  nextIp,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

/**
 * Desconto da OS no orçamento (regressão). Antes, o orçamento gravava desconto
 * 0 e total = subtotal: a OS dizia R$ 180, a prévia, o cartão e a página
 * pública diziam R$ 200, e a aprovação aplicava o desconto da OS VIVA — o
 * cartão ficava com "R$ 200" no cabeçalho e "Aprovado: R$ 180" embaixo.
 *
 * Tudo com dados fictícios e itens avulsos (sem estoque).
 */

interface Totais {
  subtotalCents: number;
  discountMode: 'AMOUNT' | 'PERCENT' | null;
  discountValue: number;
  discountCents: number;
  surchargeCents: number;
  totalCents: number;
}
interface Orcamento extends Totais {
  id: string;
  version: number;
  status: string;
  publicUrl: string;
  totalsFrozen: boolean;
  approvedTotalCents: number | null;
  items: { id: string; description: string; totalCents: number }[];
}
interface PaginaPublica extends Totais {
  contentHash: string;
  items: { id: string; description: string }[];
  decision: { decision: string; approvedTotalCents: number } | null;
}
interface Os {
  id: string;
  number: number;
  version: number;
  totals: { totalCents: number; discountCents: number; approvedTotalCents: number };
  currentQuote: { id: string } | null;
}

describe('desconto da OS no orçamento', () => {
  let t: TestApp;
  let dono: TestSession;
  let cliente: { id: string };
  let carro: { id: string };

  const auth = () => ({ headers: bearer(dono.accessToken) });
  const get = (url: string) => t.app.inject({ method: 'GET', url, ...auth() });
  const post = (url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url, payload, ...auth() });
  const patch = (url: string, payload: Record<string, unknown>) => t.app.inject({ method: 'PATCH', url, payload, ...auth() });
  const tokenOf = (q: { publicUrl: string }) => q.publicUrl.split('/').pop() as string;
  const publico = async (q: { publicUrl: string }) => {
    const res = await t.app.inject({ method: 'GET', url: `/api/v1/public/quotes/${tokenOf(q)}`, remoteAddress: nextIp() });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as PaginaPublica;
  };
  const os = async (numero: number) => (await get(`/api/v1/work-orders/${numero}`)).json() as Os;
  const orcamento = async (id: string) => (await get(`/api/v1/quotes/${id}`)).json() as Orcamento;

  /** OS com itens avulsos em rascunho e, se pedido, o desconto/acréscimo da OS. */
  async function novaOs(
    itens: { type: 'SERVICE' | 'PART'; description: string; unitPriceCents: number; isOptional?: boolean }[],
    desconto?: { discountMode: 'AMOUNT' | 'PERCENT'; discountValue: number; surchargeCents?: number },
  ): Promise<Os> {
    const criada = await createWorkOrder(t.app, dono, { customerId: cliente.id, vehicleId: carro.id, items: itens });
    if (!desconto) return os(criada.number);
    const atual = await os(criada.number);
    const res = await patch(`/api/v1/work-orders/${criada.id}`, { version: atual.version, ...desconto });
    expect(res.statusCode, res.body).toBe(200);
    return os(criada.number);
  }
  async function enviar(o: Os): Promise<Orcamento> {
    const res = await post(`/api/v1/work-orders/${o.id}/quotes`);
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as Orcamento;
  }
  async function aprovarPeloLink(q: Orcamento, descricoes?: string[]) {
    const pagina = await publico(q);
    const ids = pagina.items.filter((i) => !descricoes || descricoes.includes(i.description)).map((i) => i.id);
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/public/quotes/${tokenOf(q)}/approve`,
      remoteAddress: nextIp(),
      payload: { approvedItemIds: ids, signerName: 'Cliente Fictício', accepted: true, contentHash: pagina.contentHash },
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as PaginaPublica;
  }
  /** Os números do orçamento, sem id nem datas. */
  const numeros = (q: Totais) => ({
    subtotalCents: q.subtotalCents,
    discountMode: q.discountMode,
    discountValue: q.discountValue,
    discountCents: q.discountCents,
    surchargeCents: q.surchargeCents,
    totalCents: q.totalCents,
  });

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    cliente = await createCustomer(t.app, dono, { name: 'Cliente Fictício' });
    carro = await createVehicle(t.app, dono, cliente.id, { plate: 'DSC1A23' });
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('10% sobre R$ 200 (serviço + peça): o orçamento, o link e o WhatsApp dizem R$ 180', async () => {
    const o = await novaOs(
      [
        { type: 'SERVICE', description: 'Mão de obra fictícia', unitPriceCents: 15_000 },
        { type: 'PART', description: 'Peça fictícia', unitPriceCents: 5_000 },
      ],
      { discountMode: 'PERCENT', discountValue: 1000 },
    );
    expect(o.totals).toMatchObject({ totalCents: 18_000, discountCents: 2_000 });

    const q = await enviar(o);
    const esperado = { subtotalCents: 20_000, discountMode: 'PERCENT', discountValue: 1000, discountCents: 2_000, surchargeCents: 0, totalCents: 18_000 };
    expect(numeros(q)).toEqual(esperado);
    expect(q.totalsFrozen).toBe(true);
    expect(numeros(await publico(q))).toEqual(esperado);

    const msg = (await post(`/api/v1/quotes/${q.id}/share`, { channel: 'COPY_LINK' })).json() as { message: string };
    expect(msg.message).toMatch(/R\$\s180,00/);
    expect(msg.message).not.toMatch(/R\$\s200,00/);

    // aprovado tudo: cabeçalho, aprovado e o que a OS cobra são o mesmo número
    const decidido = await aprovarPeloLink(q);
    expect(decidido.decision).toMatchObject({ decision: 'APPROVED', approvedTotalCents: 18_000 });
    const cartao = await orcamento(q.id);
    expect(cartao.totalCents).toBe(18_000);
    expect(cartao.approvedTotalCents).toBe(18_000);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(18_000);
  });

  it('valor fixo com centavos e aprovação parcial: o desconto é rateado e bate com o que a OS cobra', async () => {
    const o = await novaOs(
      [
        { type: 'SERVICE', description: 'Serviço com centavos', unitPriceCents: 12_345 },
        { type: 'PART', description: 'Peça recomendada', unitPriceCents: 6_789, isOptional: true },
      ],
      { discountMode: 'AMOUNT', discountValue: 1_999 },
    );
    const q = await enviar(o);
    expect(numeros(q)).toEqual({
      subtotalCents: 19_134,
      discountMode: 'AMOUNT',
      discountValue: 1_999,
      discountCents: 1_999,
      surchargeCents: 0,
      totalCents: 17_135,
    });

    const decidido = await aprovarPeloLink(q, ['Serviço com centavos']);
    // 1.999 × 12.345 / 19.134 = 1.289,7 → 1.290 (meio para cima)
    expect(decidido.decision).toMatchObject({ decision: 'PARTIALLY_APPROVED', approvedTotalCents: 12_345 - 1_290 });
    expect((await orcamento(q.id)).approvedTotalCents).toBe(11_055);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(11_055);
  });

  it('percentual com aprovação parcial registrada pela equipe', async () => {
    const o = await novaOs(
      [
        { type: 'SERVICE', description: 'Revisão fictícia', unitPriceCents: 30_000 },
        { type: 'PART', description: 'Filtro fictício', unitPriceCents: 9_999, isOptional: true },
      ],
      { discountMode: 'PERCENT', discountValue: 1250 },
    );
    const q = await enviar(o);
    // 12,5% de 399,99 = 49,99875 → 50,00
    expect(numeros(q)).toMatchObject({ subtotalCents: 39_999, discountCents: 5_000, totalCents: 34_999 });

    const servico = q.items.find((i) => i.description === 'Revisão fictícia')!;
    const res = await post(`/api/v1/quotes/${q.id}/manual-decision`, {
      decision: 'PARTIALLY_APPROVED',
      channel: 'PHONE',
      approvedItemIds: [servico.id],
    });
    expect(res.statusCode, res.body).toBe(200);
    // 12,5% sobre os R$ 300 aprovados
    expect((res.json() as Orcamento).approvedTotalCents).toBe(26_250);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(26_250);
  });

  it('sem desconto: total = subtotal e nenhuma regra gravada', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Sem desconto', unitPriceCents: 20_000 }]);
    const q = await enviar(o);
    expect(numeros(q)).toEqual({
      subtotalCents: 20_000,
      discountMode: null,
      discountValue: 0,
      discountCents: 0,
      surchargeCents: 0,
      totalCents: 20_000,
    });
    await aprovarPeloLink(q);
    expect((await orcamento(q.id)).approvedTotalCents).toBe(20_000);
  });

  it('o acréscimo da OS entra no orçamento e na aprovação', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Com acréscimo', unitPriceCents: 10_000 }], {
      discountMode: 'AMOUNT',
      discountValue: 1_000,
      surchargeCents: 350,
    });
    const q = await enviar(o);
    expect(numeros(q)).toMatchObject({ discountCents: 1_000, surchargeCents: 350, totalCents: 9_350 });
    expect((await aprovarPeloLink(q)).decision?.approvedTotalCents).toBe(9_350);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(9_350);
  });

  it('mexer no desconto da OS depois do envio não muda o orçamento enviado nem o aprovado', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Congelado', unitPriceCents: 20_000 }], {
      discountMode: 'PERCENT',
      discountValue: 1000,
    });
    const q = await enviar(o);
    const antes = numeros(q);
    const hashAntes = (await publico(q)).contentHash;

    const atual = await os(o.number);
    expect((await patch(`/api/v1/work-orders/${o.id}`, { version: atual.version, discountMode: 'PERCENT', discountValue: 5000 })).statusCode).toBe(200);

    expect(numeros(await orcamento(q.id))).toEqual(antes);
    const pagina = await publico(q);
    expect(numeros(pagina)).toEqual(antes);
    expect(pagina.contentHash).toBe(hashAntes);
    // o cliente aprova o que viu: R$ 180, não os R$ 100 do desconto novo
    expect((await aprovarPeloLink(q)).decision?.approvedTotalCents).toBe(18_000);
    expect((await orcamento(q.id)).approvedTotalCents).toBe(18_000);
  });

  it('nova versão: o complementar não ganha o desconto fixo de novo, e o já aprovado não muda', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Primeiro serviço', unitPriceCents: 10_000 }], {
      discountMode: 'AMOUNT',
      discountValue: 2_000,
    });
    const v1 = await enviar(o);
    expect(numeros(v1)).toMatchObject({ discountCents: 2_000, totalCents: 8_000 });
    await aprovarPeloLink(v1);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(8_000);

    // item novo na OS: o que o cliente já aprovou continua R$ 80
    expect((await post(`/api/v1/work-orders/${o.id}/items`, { type: 'PART', description: 'Peça a mais', unitPriceCents: 5_000 })).statusCode).toBe(201);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(8_000);

    const v2 = await enviar(await os(o.number));
    expect(v2.version).toBe(2);
    expect(numeros(v2)).toEqual({
      subtotalCents: 5_000,
      discountMode: 'AMOUNT',
      discountValue: 2_000,
      discountCents: 0,
      surchargeCents: 0,
      totalCents: 5_000,
    });
    await aprovarPeloLink(v2);
    // a OS cobra a soma do que cada versão mostrou: 80 + 50
    expect((await os(o.number)).totals.approvedTotalCents).toBe(13_000);
    expect(numeros(await orcamento(v1.id))).toMatchObject({ discountCents: 2_000, totalCents: 8_000 });
    expect((await orcamento(v1.id)).approvedTotalCents).toBe(8_000);
  });

  it('nova versão com percentual: cada versão leva o percentual sobre os próprios itens', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Serviço A', unitPriceCents: 10_000 }], {
      discountMode: 'PERCENT',
      discountValue: 1000,
    });
    const v1 = await enviar(o);
    // a oficina inclui um item antes de o cliente responder e manda a versão 2
    expect((await post(`/api/v1/work-orders/${o.id}/items`, { type: 'PART', description: 'Peça B', unitPriceCents: 4_999 })).statusCode).toBe(201);
    const v2 = await enviar(await os(o.number));
    expect(v2.version).toBe(2);
    expect(numeros(v2)).toMatchObject({ subtotalCents: 4_999, discountCents: 500, totalCents: 4_499 });
    // a versão substituída guarda os próprios números
    expect(await orcamento(v1.id)).toMatchObject({ status: 'SUPERSEDED', totalCents: 9_000, discountCents: 1_000 });
  });

  it('orçamento antigo (antes da correção) não é reescrito e aprova pela regra com que foi enviado', async () => {
    const o = await novaOs([{ type: 'SERVICE', description: 'Orçamento antigo', unitPriceCents: 20_000 }], {
      discountMode: 'PERCENT',
      discountValue: 1000,
    });
    const q = await enviar(o);
    // como a versão antiga gravava: desconto 0, total = subtotal, sem regra
    await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx.execute(sql`update quotes set totals_frozen = false, discount_mode = null, discount_value = 0,
                     discount_cents = 0, total_cents = subtotal_cents where id = ${q.id}`),
    );

    const antigo = await orcamento(q.id);
    expect(antigo).toMatchObject({ totalsFrozen: false, totalCents: 20_000, discountCents: 0 });
    // a aprovação desse orçamento segue a regra antiga (desconto da OS viva)
    await aprovarPeloLink(q);
    const depois = await orcamento(q.id);
    expect(depois).toMatchObject({ totalsFrozen: false, subtotalCents: 20_000, discountCents: 0, totalCents: 20_000 });
    expect(depois.approvedTotalCents).toBe(18_000);
    expect((await os(o.number)).totals.approvedTotalCents).toBe(18_000);
  });
});
