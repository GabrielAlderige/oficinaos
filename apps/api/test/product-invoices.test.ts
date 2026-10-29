import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cifrar } from '../src/core/secrets';
import { organizationFiscalSettings } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import type {
  EmissorDeNotaDePecas,
  PedidoDeNotaDePecas,
  RespostaDaNotaDePecas,
} from '../src/integrations/fiscal/nota-de-pecas';
import {
  bearer,
  createCustomer,
  createPart,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  testEnv,
  type TestApp,
  type TestSession,
} from './helpers';

interface Nota {
  id: string;
  model: string;
  status: string;
  environment: string;
  number: string | null;
  danfeUrl: string | null;
  totalCents: number;
  items: { description: string; ncm: string; cfop: string; quantity: number; discountCents: number; totalCents: number }[];
}

/** Um emissor de mentira que grava o que recebeu e responde o que o teste mandar. */
class EmissorDeTeste implements EmissorDeNotaDePecas {
  readonly driver = 'focus';
  readonly environment = 'HOMOLOGATION' as const;
  pedidos: PedidoDeNotaDePecas[] = [];
  consultas = 0;
  cancelamentos: string[] = [];
  responde: 'AUTHORIZED' | 'QUEUED' | 'REJECTED' = 'AUTHORIZED';
  consultaResponde: 'AUTHORIZED' | 'QUEUED' = 'AUTHORIZED';

  private resposta(ref: string, status: RespostaDaNotaDePecas['status']): RespostaDaNotaDePecas {
    const ok = status === 'AUTHORIZED';
    return {
      status,
      environment: 'HOMOLOGATION',
      provider: 'focus',
      providerRef: ref,
      number: ok ? '123' : null,
      series: ok ? '1' : null,
      accessKey: ok ? '3'.repeat(44) : null,
      danfeUrl: ok ? 'https://exemplo.invalido/danfe.html' : null,
      xmlUrl: null,
      qrcodeUrl: null,
      issuedAt: ok ? new Date() : null,
      rejectionReason: status === 'REJECTED' ? 'Rejeição 778: NCM inexistente' : null,
      raw: {},
    };
  }
  async emitir(pedido: PedidoDeNotaDePecas) {
    this.pedidos.push(pedido);
    return this.resposta(pedido.invoiceId, this.responde);
  }
  async consultar(input: { ref: string }) {
    this.consultas += 1;
    return this.resposta(input.ref, this.consultaResponde);
  }
  async cancelar(input: { ref: string }) {
    this.cancelamentos.push(input.ref);
    return { canceledAt: new Date(), raw: {} };
  }
}

/**
 * Nota fiscal de peças (E50).
 *
 * O que precisa ficar provado: a nota não sai com pendência (e diz qual);
 * só peça do catálogo entra, com o desconto rateado sem perder centavo; a
 * NF-e que fica na fila é consultada até a SEFAZ responder; o token da
 * oficina chega decifrado ao emissor; nota viva bloqueia a segunda nota e o
 * cancelamento da venda; cancelar a nota libera os dois.
 */
describe('nota fiscal de peças', () => {
  let t: TestApp;
  let dono: TestSession;
  const emissor = new EmissorDeTeste();
  const tokens: { token: string; environment: string }[] = [];
  let filtro: string;
  let pastilha: string;
  let semNcm: string;

  const post = (url: string, payload: unknown = {}) =>
    t.app.inject({ method: 'POST', url, headers: bearer(dono.accessToken), payload: payload as never });
  const get = (url: string) => t.app.inject({ method: 'GET', url, headers: bearer(dono.accessToken) });
  const emitir = (corpo: Record<string, unknown>) => post('/api/v1/product-invoices', { clientRequestId: randomUUID(), ...corpo });

  async function vender(itens: unknown[], extra: Record<string, unknown> = {}) {
    const r = await post('/api/v1/counter-sales', { clientRequestId: randomUUID(), items: itens, payment: { kind: 'PAID', method: 'PIX' }, ...extra });
    expect(r.statusCode, r.body).toBe(201);
    return (r.json() as { id: string }).id;
  }

  async function ligarFocus() {
    await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx
        .update(organizationFiscalSettings)
        .set({ provider: 'focus', environment: 'HOMOLOGATION', providerTokenEnc: cifrar('token-pecas', testEnv().SECRETS_KEY) })
        .where(eq(organizationFiscalSettings.organizationId, dono.orgId)),
    );
  }

  beforeAll(async () => {
    t = await createTestApp(
      {},
      {
        emissorDePecasDaOficina: (opcoes) => {
          tokens.push(opcoes);
          return emissor;
        },
      },
    );
    dono = await signup(t.app);
    filtro = (await createPart(t.app, dono, { name: 'Filtro de óleo', ncm: '8421.23.00', salePriceCents: 3_000, initialQuantity: 50, initialUnitCostCents: 1_500 })).id;
    pastilha = (await createPart(t.app, dono, { name: 'Pastilha de freio', ncm: '68138110', salePriceCents: 12_000, initialQuantity: 50, initialUnitCostCents: 6_000 })).id;
    semNcm = (await createPart(t.app, dono, { name: 'Lâmpada H4', salePriceCents: 2_500, initialQuantity: 50, initialUnitCostCents: 900 })).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('sem CNPJ, IE e NCM a nota não sai, e cada pendência diz onde resolver', async () => {
    const venda = await vender([{ partId: semNcm, quantity: 1, unitPriceCents: 2_500 }]);
    const previa = await get(`/api/v1/product-invoices/preview?counterSaleId=${venda}&model=NFCE`);
    expect(previa.statusCode, previa.body).toBe(200);
    const campos = (previa.json() as { issues: { campo: string }[] }).issues.map((p) => p.campo).sort();
    expect(campos, 'sem regime ainda, o ICMS também falta').toEqual(['cnpj', 'icms', 'ie', 'ncm']);
    const r = await emitir({ counterSaleId: venda });
    expect(r.statusCode).toBe(422);
    expect(emissor.pedidos).toHaveLength(0);

    const org = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: {
        legalName: 'Oficina do Teste LTDA',
        document: '11.222.333/0001-81',
        address: { zip: '37701-238', street: 'Rua México', number: '237', complement: '', district: 'Centro', city: 'Poços de Caldas', state: 'MG' },
      },
    });
    expect(org.statusCode, org.body).toBe(200);
    const fiscal = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/fiscal-settings',
      headers: bearer(dono.accessToken),
      payload: { stateRegistration: '0012345670099', taxRegime: 'SIMPLES_NACIONAL' },
    });
    expect(fiscal.statusCode, fiscal.body).toBe(200);
    const depois = (await get(`/api/v1/product-invoices/preview?counterSaleId=${venda}&model=NFCE`)).json() as { issues: { campo: string; mensagem: string }[] };
    expect(depois.issues.map((p) => p.campo), 'no Simples o ICMS sai 102 sozinho; só falta o NCM').toEqual(['ncm']);
    expect(depois.issues[0]!.mensagem).toContain('Lâmpada H4');
  });

  it('NFC-e do balcão no simulador: só peça entra, o desconto é rateado e a soma bate com a venda', async () => {
    const venda = await vender(
      [
        { partId: filtro, quantity: 2, unitPriceCents: 3_000 },
        { partId: pastilha, quantity: 1, unitPriceCents: 12_000 },
        { partId: null, description: 'Mão de obra da troca', quantity: 1, unitPriceCents: 6_000 },
      ],
      { discountCents: 2_400 },
    );
    const previa = (await get(`/api/v1/product-invoices/preview?counterSaleId=${venda}&model=NFCE`)).json() as {
      environment: string;
      totalCents: number;
      leftOut: { description: string }[];
      items: Nota['items'];
    };
    expect(previa.environment).toBe('SIMULATOR');
    expect(previa.leftOut.map((f) => f.description)).toEqual(['Mão de obra da troca']);
    // peças: 6.000 + 12.000 = 18.000 de 24.000 → 75% do desconto de 2.400 = 1.800
    expect(previa.items.reduce((s, i) => s + i.discountCents, 0)).toBe(1_800);
    expect(previa.totalCents).toBe(16_200);
    expect(previa.items.map((i) => [i.ncm, i.cfop])).toEqual([
      ['84212300', '5102'],
      ['68138110', '5102'],
    ]);

    const r = await emitir({ counterSaleId: venda });
    expect(r.statusCode, r.body).toBe(201);
    const nota = r.json() as Nota;
    expect(nota).toMatchObject({ model: 'NFCE', status: 'AUTHORIZED', environment: 'SIMULATOR', totalCents: 16_200 });
    expect(nota.danfeUrl, 'simulação não inventa DANFE').toBeNull();
    expect(emissor.pedidos, 'simulador não chama o emissor de verdade').toHaveLength(0);

    const segunda = await emitir({ counterSaleId: venda });
    expect(segunda.statusCode, 'nota viva bloqueia a segunda').toBe(409);
  });

  it('o mesmo pedido repetido (clique duplo) devolve a mesma nota', async () => {
    const venda = await vender([{ partId: filtro, quantity: 1, unitPriceCents: 3_000 }]);
    const id = randomUUID();
    const a = await post('/api/v1/product-invoices', { clientRequestId: id, counterSaleId: venda });
    const b = await post('/api/v1/product-invoices', { clientRequestId: id, counterSaleId: venda });
    expect(a.statusCode, a.body).toBe(201);
    expect((b.json() as Nota).id).toBe((a.json() as Nota).id);
  });

  it('com a Focus ligada: o token chega decifrado, a nota autoriza e cancelar libera a venda', async () => {
    await ligarFocus();
    emissor.responde = 'AUTHORIZED';
    const venda = await vender([{ partId: pastilha, quantity: 1, unitPriceCents: 12_000 }]);
    const r = await emitir({ counterSaleId: venda });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ status: 'AUTHORIZED', environment: 'HOMOLOGATION', number: '123' });
    expect(tokens.at(-1)).toEqual({ token: 'token-pecas', environment: 'HOMOLOGATION' });
    const pedido = emissor.pedidos.at(-1)!;
    expect(pedido).toMatchObject({ modelo: 'NFCE', icmsSituacao: '102', emitente: { cnpj: '11222333000181', uf: 'MG' } });
    expect(pedido.pagamento.forma, 'Pix na tabela da SEFAZ').toBe('17');

    const cancelarVenda = await post(`/api/v1/counter-sales/${venda}/cancel`, { reason: 'cliente desistiu' });
    expect(cancelarVenda.statusCode, 'venda com nota não se desfaz antes da nota').toBe(409);

    const curto = await post(`/api/v1/product-invoices/${(r.json() as Nota).id}/cancel`, { reason: 'erro' });
    expect(curto.statusCode).toBe(400);
    const cancelada = await post(`/api/v1/product-invoices/${(r.json() as Nota).id}/cancel`, { reason: 'Venda desfeita a pedido do cliente' });
    expect(cancelada.statusCode, cancelada.body).toBe(200);
    expect((cancelada.json() as Nota).status).toBe('CANCELED');
    expect(emissor.cancelamentos).toContain((r.json() as Nota).id);
    expect((await post(`/api/v1/counter-sales/${venda}/cancel`, { reason: 'cliente desistiu' })).statusCode).toBe(200);
  });

  it('recusa da SEFAZ fica registrada com o motivo e não prende a venda', async () => {
    emissor.responde = 'REJECTED';
    const venda = await vender([{ partId: filtro, quantity: 1, unitPriceCents: 3_000 }]);
    const r = await emitir({ counterSaleId: venda });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ status: 'REJECTED', rejectionReason: 'Rejeição 778: NCM inexistente' });
    emissor.responde = 'AUTHORIZED';
    expect((await emitir({ counterSaleId: venda })).statusCode, 'recusada não conta como nota viva').toBe(201);
  });

  it('NF-e da OS: só a peça que a oficina forneceu, cliente com endereço, e a fila é consultada até autorizar', async () => {
    const cliente = await createCustomer(t.app, dono, {
      name: 'Transportes Lima LTDA',
      type: 'PJ',
      document: '11.444.777/0001-61',
      address: { zip: '37701-238', street: 'Rua das Flores', number: '25', complement: '', district: 'Centro', city: 'Poços de Caldas', state: 'MG' },
    });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'NFE1A23', make: 'Fiat', model: 'Strada' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [
        { type: 'PART', partId: pastilha, quantity: 2, unitPriceCents: 12_000 },
        { type: 'PART', description: 'Bateria do cliente', quantity: 1, unitPriceCents: 0, sourcing: 'CUSTOMER_PROVIDED' },
        { type: 'SERVICE', description: 'Troca das pastilhas', quantity: 1, unitPriceCents: 8_000 },
      ],
    });
    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`);
    expect(orcamento.statusCode, orcamento.body).toBe(201);
    await post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect((await post(`/api/v1/work-orders/${os.id}/start`)).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${os.id}/complete`)).statusCode).toBe(200);

    const previa = (await get(`/api/v1/product-invoices/preview?workOrderId=${os.id}&model=NFE`)).json() as {
      issues: unknown[];
      items: Nota['items'];
      leftOut: { description: string; reason: string }[];
    };
    expect(previa.issues).toEqual([]);
    expect(previa.items.map((i) => [i.description, i.quantity, i.totalCents])).toEqual([['Pastilha de freio', 2, 24_000]]);
    expect(previa.leftOut).toEqual([{ description: 'Bateria do cliente', reason: 'peça trazida pelo cliente' }]);

    emissor.responde = 'QUEUED';
    emissor.consultaResponde = 'QUEUED';
    const r = await emitir({ workOrderId: os.id, model: 'NFE' });
    expect(r.statusCode, r.body).toBe(201);
    expect((r.json() as Nota).status).toBe('QUEUED');
    expect(emissor.pedidos.at(-1)?.destinatario?.endereco?.city).toBe('Poços de Caldas');

    emissor.consultaResponde = 'AUTHORIZED';
    const antes = emissor.consultas;
    const lida = (await get(`/api/v1/product-invoices/${(r.json() as Nota).id}`)).json() as Nota;
    expect(emissor.consultas).toBe(antes + 1);
    expect(lida).toMatchObject({ status: 'AUTHORIZED', number: '123' });
    const lista = (await get(`/api/v1/product-invoices?workOrderId=${os.id}`)).json() as { data: Nota[] };
    expect(lista.data).toHaveLength(1);
    emissor.responde = 'AUTHORIZED';
  });

  it('a NF-e sem endereço do cliente avisa antes de mandar', async () => {
    const venda = await vender([{ partId: filtro, quantity: 1, unitPriceCents: 3_000 }]);
    const previa = (await get(`/api/v1/product-invoices/preview?counterSaleId=${venda}&model=NFE`)).json() as { issues: { campo: string }[] };
    expect(previa.issues.map((p) => p.campo).sort()).toEqual(['cliente', 'endereco']);
  });
});
