import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  type TestApp,
  type TestSession,
  type TestWorkOrder,
} from './helpers';

interface Nota {
  id: string;
  status: string;
  environment: string;
  provider: string | null;
  rpsNumber: number;
  rpsSeries: string;
  invoiceNumber: string | null;
  verificationCode: string | null;
  pdfUrl: string | null;
  serviceAmountCents: number;
  discountCents: number;
  baseAmountCents: number;
  issRateBps: number;
  issAmountCents: number;
  issRetained: boolean;
  totalCents: number;
  netCents: number;
  description: string;
  canceledAt: string | null;
  cancelReason: string | null;
  items: { description: string; totalCents: number }[];
}

interface Previa {
  serviceAmountCents: number;
  partsAmountCents: number;
  discountCents: number;
  issAmountCents: number;
  totalCents: number;
  environment: string;
  pending: { onde: string; campo: string; mensagem: string }[];
  existingInvoiceId: string | null;
  items: { description: string }[];
}

/**
 * Nota fiscal de serviço (V3, E18).
 *
 * O que precisa ficar provado aqui, porque nenhum teste de tela alcança:
 * a nota cobre SÓ serviço (peça é outra nota), o que entra é o que o cliente
 * paga, o ISS sai de dentro do preço, o dado que falta vira recusa explicando
 * ONDE resolver, o mesmo POST não emite duas notas, e cancelar exige motivo e
 * permissão própria.
 *
 * O emissor é o **simulador**: ele não emite documento fiscal nenhum, e é por
 * isso que todo teste confere `environment: 'SIMULATOR'` e `pdfUrl: null`.
 */
describe('nota fiscal de serviço', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let servicoId: string;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const put = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PUT', url, headers: bearer(s.accessToken), payload: payload as never });

  const ENDERECO = {
    zip: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    complement: '',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };

  const DADOS_FISCAIS = {
    municipalRegistration: '123456',
    taxRegime: 'SIMPLES_NACIONAL',
    serviceListItem: '14.01',
    issRateBps: 500,
    rpsSeries: '1',
  };

  async function configurarOficina() {
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: {
        legalName: 'Oficina do Gabriel LTDA',
        document: '11.222.333/0001-81',
        address: ENDERECO,
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await put('/api/v1/fiscal-settings', DADOS_FISCAIS)).statusCode).toBe(200);
  }

  /** OS finalizada com um serviço de R$ 400 e (opcionalmente) uma peça. */
  async function osFinalizada(extra: { comPeca?: boolean; desconto?: number; semEnderecoDoCliente?: boolean } = {}) {
    // sem CPF de propósito: nota para consumidor não identificado é válida, e
    // o documento é único por oficina (cada caso aqui cria um cliente novo)
    const cliente = await createCustomer(t.app, dono, {
      name: 'João Pereira',
      address: extra.semEnderecoDoCliente
        ? undefined
        : { ...ENDERECO, street: 'Rua das Flores', number: '25' },
    });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: placa(), make: 'Fiat', model: 'Argo' });
    const itens: Record<string, unknown>[] = [{ type: 'SERVICE', serviceId: servicoId }];
    if (extra.comPeca) itens.push({ type: 'PART', description: 'Filtro de óleo', quantity: 1, unitPriceCents: 6_000 });

    const os = await createWorkOrder(t.app, dono, { customerId: cliente.id, vehicleId: veiculo.id, items: itens });
    if (extra.desconto) {
      const atual = (await get(`/api/v1/work-orders/${os.number}`)).json() as { version: number };
      const alterou = await t.app.inject({
        method: 'PATCH',
        url: `/api/v1/work-orders/${os.id}`,
        headers: bearer(dono.accessToken),
        payload: { version: atual.version, discountMode: 'AMOUNT', discountValue: extra.desconto },
      });
      expect(alterou.statusCode, alterou.body).toBe(200);
    }
    // a OS só chega em "finalizada" pelo caminho normal: orçamento aprovado
    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`, {});
    expect(orcamento.statusCode, orcamento.body).toBe(201);
    const decisao = await post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, {
      decision: 'APPROVED',
      channel: 'PHONE',
    });
    expect(decisao.statusCode, decisao.body).toBe(200);
    expect((await post(`/api/v1/work-orders/${os.id}/start`)).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${os.id}/complete`)).statusCode).toBe(200);
    return os;
  }

  let sequencia = 0;
  const placa = () => `NFS${sequencia++}A23`.slice(0, 7).toUpperCase().padEnd(7, '0');

  const emitir = (os: TestWorkOrder, payload: Record<string, unknown> = {}, s: TestSession = dono) =>
    post(`/api/v1/work-orders/${os.id}/invoices`, { clientRequestId: randomUUID(), ...payload }, s);

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    const servico = await post('/api/v1/services', { name: 'Revisão completa', priceCents: 40_000 });
    servicoId = (servico.json() as { id: string }).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ---------------------------- o que falta -----------------------------

  it('sem os dados fiscais, a prévia diz o que falta e ONDE resolver — e a emissão é recusada', async () => {
    const os = await osFinalizada();
    const previa = (await get(`/api/v1/work-orders/${os.id}/invoices/preview`)).json() as Previa;
    const campos = previa.pending.map((item) => item.campo);
    expect(campos, 'a inscrição municipal é o que identifica a oficina na prefeitura').toContain('municipalRegistration');
    expect(campos).toContain('issRateBps');
    expect(previa.pending.every((item) => item.mensagem.length > 10), 'mensagem de gente, não código').toBe(true);

    const recusou = await emitir(os);
    expect(recusou.statusCode, recusou.body).toBe(422);
    const corpo = recusou.json() as { code: string; errors: { path: string; message: string }[] };
    expect(corpo.code).toBe('VALIDATION_FAILED');
    expect(corpo.errors.some((erro) => erro.path === 'oficina.municipalRegistration')).toBe(true);
  });

  // ------------------------------ emissão -------------------------------

  it('emite a nota do serviço, com o ISS por dentro e a peça de fora', async () => {
    await configurarOficina();
    const os = await osFinalizada({ comPeca: true });

    const previa = (await get(`/api/v1/work-orders/${os.id}/invoices/preview`)).json() as Previa;
    expect(previa.pending, 'com tudo preenchido não falta nada').toEqual([]);
    expect(previa.serviceAmountCents).toBe(40_000);
    expect(previa.partsAmountCents, 'a peça aparece, mas fora da nota de serviço').toBe(6_000);

    const res = await emitir(os);
    expect(res.statusCode, res.body).toBe(201);
    const nota = res.json() as Nota;

    expect(nota.status).toBe('AUTHORIZED');
    expect(nota.environment, 'o simulador não emite documento fiscal').toBe('SIMULATOR');
    expect(nota.pdfUrl, 'e por isso não inventa PDF de nota').toBeNull();
    expect(nota.invoiceNumber).toBeTruthy();
    expect(nota.verificationCode).toBeTruthy();
    expect(nota.rpsNumber).toBe(1);

    expect(nota.serviceAmountCents, 'só o serviço').toBe(40_000);
    expect(nota.totalCents).toBe(40_000);
    expect(nota.issAmountCents, '5% de 400,00').toBe(2_000);
    expect(nota.netCents, 'sem retenção, a oficina recebe o total').toBe(40_000);
    expect(nota.items).toHaveLength(1);
    expect(nota.items[0]!.description).toContain('Revisão');
    expect(nota.description, 'o cliente reconhece o carro na prefeitura').toContain('OS nº');

    // e a OS conta a história
    const timeline = (await get(`/api/v1/work-orders/${os.id}/timeline`)).json() as { data: { type: string }[] };
    expect(timeline.data.some((evento) => evento.type === 'INVOICE_ISSUED')).toBe(true);
  });

  it('o desconto da OS entra na nota só na parte que é de serviço', async () => {
    // R$ 400 de serviço + R$ 60 de peça, R$ 46 de desconto → 40/46 avos são do serviço
    const os = await osFinalizada({ comPeca: true, desconto: 4_600 });
    const nota = (await emitir(os)).json() as Nota;
    expect(nota.discountCents).toBe(4_000);
    expect(nota.totalCents).toBe(36_000);
    expect(nota.baseAmountCents).toBe(36_000);
    expect(nota.issAmountCents).toBe(1_800);
  });

  it('com ISS retido pelo tomador, a oficina não recolhe e recebe menos', async () => {
    const os = await osFinalizada();
    const nota = (await emitir(os, { issRetained: true })).json() as Nota;
    expect(nota.issRetained).toBe(true);
    expect(nota.issAmountCents).toBe(2_000);
    expect(nota.netCents).toBe(38_000);
  });

  it('o mesmo pedido repetido não emite duas notas', async () => {
    const os = await osFinalizada();
    const clientRequestId = randomUUID();
    const primeira = await emitir(os, { clientRequestId });
    expect(primeira.statusCode, primeira.body).toBe(201);
    const segunda = await emitir(os, { clientRequestId });
    expect(segunda.statusCode, segunda.body).toBe(201);
    expect((segunda.json() as Nota).id).toBe((primeira.json() as Nota).id);

    const lista = (await get(`/api/v1/work-orders/${os.id}/invoices`)).json() as { data: Nota[] };
    expect(lista.data, 'uma OS, uma nota').toHaveLength(1);
  });

  it('OS que já tem nota não emite outra — até cancelar a primeira', async () => {
    const os = await osFinalizada();
    const primeira = (await emitir(os)).json() as Nota;

    const segunda = await emitir(os);
    expect(segunda.statusCode).toBe(409);

    const cancelou = await post(`/api/v1/invoices/${primeira.id}/cancel`, { reason: 'Valor errado na nota' });
    expect(cancelou.statusCode, cancelou.body).toBe(200);
    const cancelada = cancelou.json() as Nota;
    expect(cancelada.status).toBe('CANCELED');
    expect(cancelada.canceledAt).toBeTruthy();
    expect(cancelada.cancelReason).toBe('Valor errado na nota');

    const terceira = await emitir(os);
    expect(terceira.statusCode, terceira.body).toBe(201);
    expect((terceira.json() as Nota).rpsNumber, 'o RPS segue a sequência da oficina').toBeGreaterThan(
      primeira.rpsNumber,
    );
  });

  it('serviço que ainda não terminou não gera nota', async () => {
    const cliente = await createCustomer(t.app, dono, {
      name: 'Maria Souza',
      address: { ...ENDERECO, street: 'Rua B', number: '1' },
    });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: 'NFA2B34' });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const res = await emitir(os);
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { code: string }).code).toBe('INVALID_TRANSITION');
  });

  // ---------------------------- cancelamento -----------------------------

  it('cancelar exige motivo escrito e permissão própria', async () => {
    const os = await osFinalizada();
    const nota = (await emitir(os)).json() as Nota;

    const semMotivo = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'x' });
    expect(semMotivo.statusCode, 'motivo de uma letra não conta história').toBe(400);

    const peloAtendente = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'Cliente pediu outra' }, atendente);
    expect(peloAtendente.statusCode, 'o atendente emite, mas não cancela').toBe(403);

    const doDono = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'Cliente pediu outra' });
    expect(doDono.statusCode, doDono.body).toBe(200);

    const denovo = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'Cliente pediu outra' });
    expect(denovo.statusCode, 'cancelar duas vezes não é cancelar duas vezes').toBe(409);
  });

  it('o atendente emite a nota do carro que ele mesmo entrega', async () => {
    const os = await osFinalizada();
    const res = await emitir(os, {}, atendente);
    expect(res.statusCode, res.body).toBe(201);
  });

  // ------------------------------- listagem -------------------------------

  it('a lista traz as notas da oficina, da mais nova para a mais velha', async () => {
    const lista = await get('/api/v1/invoices?pageSize=5');
    expect(lista.statusCode, lista.body).toBe(200);
    const corpo = lista.json() as { data: Nota[]; meta: { total: number } };
    expect(corpo.meta.total).toBeGreaterThan(0);
    expect(corpo.data.every((nota) => nota.environment === 'SIMULATOR')).toBe(true);
  });

  it('o mecânico não vê nota fiscal', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    const res = await get('/api/v1/invoices', mecanico);
    expect(res.statusCode).toBe(403);
  });
});
