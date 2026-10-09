import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cifrar } from '../src/core/secrets';
import { organizationFiscalSettings } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { codigoTributacaoNacional, FocusNfseProvider, montarDps } from '../src/integrations/fiscal/focus';
import type { NfseProvider, PedidoDeNfse, RespostaDoEmissor } from '../src/integrations/fiscal/nfse';
import {
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  createWorkOrder,
  signup,
  testDb,
  testEnv,
  type TestApp,
  type TestSession,
  type TestWorkOrder,
} from './helpers';

/**
 * NFS-e de verdade pela Focus NFe (padrão nacional).
 *
 * Duas partes. A primeira prova o conector contra respostas da Focus copiadas
 * da documentação deles: o JSON que sai, a autenticação, e a tradução de cada
 * situação (na fila, autorizada, recusada, referência repetida, token errado).
 * A segunda prova o caminho inteiro pela API com um emissor falso: a oficina
 * ligada emite pela Focus com o token DELA, a nota que fica na fila é
 * consultada de novo na leitura, salvar a configuração não desliga o emissor,
 * e o cancelamento vai para o mesmo emissor que emitiu.
 */

const PEDIDO: PedidoDeNfse = {
  invoiceId: '0190d0c0-0000-7000-8000-000000000001',
  rpsNumber: 7,
  rpsSeries: '1',
  prestador: {
    document: '11.222.333/0001-81',
    legalName: 'Oficina do Gabriel LTDA',
    municipalRegistration: '12.345-6',
    city: 'Poços de Caldas',
    state: 'MG',
    taxRegime: 'SIMPLES_NACIONAL',
    serviceListItem: '14.01',
    municipalServiceCode: null,
    cnae: null,
    providerCompanyId: null,
    ibgeCityCode: '3151800',
    nationalServiceCode: null,
  },
  tomador: {
    name: 'João Pereira',
    document: '529.982.247-25',
    email: 'joao@exemplo.invalido',
    zip: '37701-238',
    street: 'Rua México',
    number: '237',
    complement: null,
    district: 'Centro',
    city: 'Poços de Caldas',
    state: 'MG',
  },
  servicos: [{ description: 'Revisão completa', quantity: 1, unitPriceCents: 40_000, totalCents: 40_000 }],
  discriminacao: 'Revisão completa - Fiat Argo placa NFS0A23',
  valores: {
    serviceAmountCents: 40_000,
    deductionsCents: 0,
    discountCents: 2_500,
    baseAmountCents: 37_500,
    issRateBps: 500,
    issAmountCents: 1_875,
    issRetained: false,
    irrfCents: 0,
    pisCents: 0,
    cofinsCents: 0,
    csllCents: 0,
    inssCents: 0,
    totalCents: 37_500,
  },
};

/** fetch falso: devolve as respostas na ordem e guarda o que foi pedido. */
function focusFalsa(respostas: { status: number; body: unknown }[]) {
  const chamadas: { url: string; metodo: string; auth: string; corpo: Record<string, unknown> | null }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    chamadas.push({
      url,
      metodo: init.method ?? 'GET',
      auth: new Headers(init.headers).get('authorization') ?? '',
      corpo: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    const r = respostas.shift();
    if (!r) throw new Error('chamada a mais para a Focus');
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const emissor = new FocusNfseProvider({
    token: 'token-da-oficina',
    environment: 'HOMOLOGATION',
    fetch: http,
    agora: () => new Date('2026-10-09T15:30:00Z'),
  });
  return { emissor, chamadas };
}

const AUTORIZADA = {
  status: 'autorizado',
  ref: PEDIDO.invoiceId,
  numero: '74798',
  codigo_verificacao: 'ABC123',
  data_emissao: '2026-10-09T12:30:05-03:00',
  url: 'https://www.nfse.gov.br/consultapublica/?tpc=1&chave=3151800',
  caminho_xml_nota_fiscal: '/arquivos/11222333000181_1/202610/XMLsNFSe/NFS3151800-nfse.xml',
  url_danfse: 'https://focusnfe.s3.sa-east-1.amazonaws.com/arquivos/DANFSEs/NFS3151800.pdf',
};

describe('conector da Focus NFe', () => {
  it('monta o JSON do padrão nacional com o que a nota precisa', () => {
    const dps = montarDps(PEDIDO, new Date('2026-10-09T15:30:00Z'));
    expect(dps).toMatchObject({
      data_emissao: '2026-10-09T12:30:00-03:00',
      data_competencia: '2026-10-09',
      serie_dps: 1,
      numero_dps: 7,
      emitente_dps: 1,
      codigo_municipio_emissora: 3151800,
      codigo_municipio_prestacao: '3151800',
      cnpj_prestador: '11222333000181',
      inscricao_municipal_prestador: '123456',
      codigo_opcao_simples_nacional: 3,
      regime_tributario_simples_nacional: 1,
      codigo_tributacao_nacional_iss: '140101',
      valor_servico: 400,
      desconto_incondicionado: 25,
      tributacao_iss: 1,
      tipo_retencao_iss: 1,
      cpf_tomador: '52998224725',
      razao_social_tomador: 'João Pereira',
      cep_tomador: '37701238',
    });
  });

  it('cliente sem CPF vai como não identificado: nenhum campo de tomador inventado', () => {
    const dps = montarDps({ ...PEDIDO, tomador: { ...PEDIDO.tomador, document: null } }, new Date());
    expect(Object.keys(dps).filter((campo) => campo.endsWith('_tomador'))).toEqual([]);
  });

  it('o código nacional informado vence o que sai do item da LC 116; MEI é opção 2', () => {
    expect(codigoTributacaoNacional({ ...PEDIDO, prestador: { ...PEDIDO.prestador, nationalServiceCode: '140102' } })).toBe('140102');
    const mei = montarDps({ ...PEDIDO, prestador: { ...PEDIDO.prestador, taxRegime: 'MEI' } }, new Date());
    expect(mei.codigo_opcao_simples_nacional).toBe(2);
    expect(mei.regime_tributario_simples_nacional, 'só ME/EPP diz o regime de apuração').toBeUndefined();
  });

  it('emite com o token da oficina (Basic, senha vazia) e fica na fila', async () => {
    const { emissor, chamadas } = focusFalsa([{ status: 202, body: { status: 'processando_autorizacao', ref: PEDIDO.invoiceId } }]);
    const r = await emissor.emitir(PEDIDO);
    expect(r).toMatchObject({ status: 'QUEUED', environment: 'HOMOLOGATION', provider: 'focus', providerRef: PEDIDO.invoiceId });
    expect(chamadas[0]!.url).toBe(`https://homologacao.focusnfe.com.br/v2/nfsen?ref=${PEDIDO.invoiceId}`);
    expect(chamadas[0]!.metodo).toBe('POST');
    expect(chamadas[0]!.auth).toBe(`Basic ${Buffer.from('token-da-oficina:').toString('base64')}`);
  });

  it('consulta autorizada traz número, código, link público, PDF e o XML com o endereço completo', async () => {
    const { emissor, chamadas } = focusFalsa([{ status: 200, body: AUTORIZADA }]);
    const r = await emissor.consultar({ providerRef: PEDIDO.invoiceId, invoiceId: PEDIDO.invoiceId });
    expect(chamadas[0]!.url).toBe(`https://homologacao.focusnfe.com.br/v2/nfsen/${PEDIDO.invoiceId}`);
    expect(r).toMatchObject({
      status: 'AUTHORIZED',
      invoiceNumber: '74798',
      verificationCode: 'ABC123',
      publicUrl: AUTORIZADA.url,
      pdfUrl: AUTORIZADA.url_danfse,
      xmlUrl: `https://homologacao.focusnfe.com.br${AUTORIZADA.caminho_xml_nota_fiscal}`,
    });
    expect(r.issuedAt?.toISOString()).toBe('2026-10-09T15:30:05.000Z');
  });

  it('recusa da prefeitura vira motivo legível, com a correção sugerida', async () => {
    const { emissor } = focusFalsa([
      {
        status: 200,
        body: {
          status: 'erro_autorizacao',
          erros: [{ codigo: 'E0312', mensagem: 'Inscrição municipal inválida', correcao: 'Confira o cadastro na prefeitura' }],
        },
      },
    ]);
    const r = await emissor.consultar({ providerRef: PEDIDO.invoiceId, invoiceId: PEDIDO.invoiceId });
    expect(r.status).toBe('REJECTED');
    expect(r.rejectionReason).toBe('Inscrição municipal inválida (Confira o cadastro na prefeitura)');
  });

  it('referência repetida não emite de novo: consulta a nota que já está lá', async () => {
    const { emissor, chamadas } = focusFalsa([
      { status: 422, body: { codigo: 'erro_validacao', mensagem: 'Já existe um DPS com esta referência.' } },
      { status: 200, body: AUTORIZADA },
    ]);
    const r = await emissor.emitir(PEDIDO);
    expect(r.status).toBe('AUTHORIZED');
    expect(chamadas.map((c) => c.metodo)).toEqual(['POST', 'GET']);
  });

  it('dado inválido volta recusado na hora; token errado diz para falar com o suporte', async () => {
    const invalido = focusFalsa([{ status: 400, body: { codigo: 'requisicao_invalida', mensagem: 'O campo dfe.prestador.cpf_cnpj é obrigatório.' } }]);
    expect(await invalido.emissor.emitir(PEDIDO)).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'O campo dfe.prestador.cpf_cnpj é obrigatório.',
    });
    const token = focusFalsa([{ status: 401, body: 'HTTP Basic: Access denied' }]);
    expect((await token.emissor.emitir(PEDIDO)).rejectionReason).toMatch(/suporte do OficinaOS/);
  });

  it('Focus fora do ar é erro (a API marca a nota para tentar de novo), não "recusada pela prefeitura"', async () => {
    const { emissor } = focusFalsa([{ status: 503, body: {} }]);
    await expect(emissor.emitir(PEDIDO)).rejects.toThrow(/503/);
  });

  it('cancela com a justificativa; cancelamento recusado vira erro com o motivo', async () => {
    const ok = focusFalsa([{ status: 200, body: { status: 'cancelado' } }]);
    await ok.emissor.cancelar({ providerRef: PEDIDO.invoiceId, invoiceId: PEDIDO.invoiceId, reason: 'Serviço lançado em duplicidade' });
    expect(ok.chamadas[0]).toMatchObject({ metodo: 'DELETE', corpo: { justificativa: 'Serviço lançado em duplicidade' } });

    const recusado = focusFalsa([{ status: 200, body: { status: 'erro_cancelamento', erros: [{ mensagem: 'Prazo de cancelamento expirado' }] } }]);
    await expect(
      recusado.emissor.cancelar({ providerRef: PEDIDO.invoiceId, invoiceId: PEDIDO.invoiceId, reason: 'Motivo qualquer' }),
    ).rejects.toThrow('Prazo de cancelamento expirado');
  });
});

// ------------------------------------------------------------------ pela API

interface Nota {
  id: string;
  status: string;
  environment: string;
  provider: string | null;
  invoiceNumber: string | null;
  pdfUrl: string | null;
  rejectionReason: string | null;
}

/** Emissor falso que obedece a um roteiro que o teste muda no meio do caminho. */
class EmissorDeRoteiro implements NfseProvider {
  readonly driver = 'focus';
  readonly environment = 'HOMOLOGATION' as const;
  consultaResponde: RespostaDoEmissor['status'] = 'QUEUED';
  pedidos: PedidoDeNfse[] = [];
  consultas = 0;
  cancelamentos: string[] = [];
  cancelamentoFalha = false;

  private resposta(status: RespostaDoEmissor['status'], ref: string): RespostaDoEmissor {
    return {
      status,
      environment: 'HOMOLOGATION',
      provider: 'focus',
      providerRef: ref,
      invoiceNumber: status === 'AUTHORIZED' ? '74798' : null,
      verificationCode: status === 'AUTHORIZED' ? 'ABC123' : null,
      publicUrl: null,
      pdfUrl: status === 'AUTHORIZED' ? 'https://exemplo.invalido/danfse.pdf' : null,
      xmlUrl: null,
      issuedAt: status === 'AUTHORIZED' ? new Date() : null,
      rejectionReason: null,
      raw: { roteiro: status },
    };
  }

  async emitir(pedido: PedidoDeNfse) {
    this.pedidos.push(pedido);
    return this.resposta('QUEUED', pedido.invoiceId);
  }

  async consultar(input: { providerRef: string | null; invoiceId: string }) {
    this.consultas += 1;
    return this.resposta(this.consultaResponde, input.invoiceId);
  }

  async cancelar(input: { providerRef: string | null; invoiceId: string; reason: string }) {
    if (this.cancelamentoFalha) throw new Error('A prefeitura não cancelou a nota: Prazo de cancelamento expirado');
    this.cancelamentos.push(input.reason);
    return { canceledAt: new Date(), provider: 'focus', raw: {} };
  }
}

describe('NFS-e de verdade pela API (oficina ligada na Focus)', () => {
  let t: TestApp;
  let dono: TestSession;
  let servicoId: string;
  const emissor = new EmissorDeRoteiro();
  const tokensRecebidos: { token: string; environment: string }[] = [];

  const post = (url: string, payload: unknown = {}) =>
    t.app.inject({ method: 'POST', url, headers: bearer(dono.accessToken), payload: payload as never });
  const get = (url: string) => t.app.inject({ method: 'GET', url, headers: bearer(dono.accessToken) });

  let sequencia = 0;
  async function osFinalizada(): Promise<TestWorkOrder> {
    const cliente = await createCustomer(t.app, dono, {
      name: 'João Pereira',
      address: { zip: '37701-238', street: 'Rua das Flores', number: '25', complement: '', district: 'Centro', city: 'Poços de Caldas', state: 'MG' },
    });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: `FOC${sequencia++}A23`.slice(0, 7), make: 'Fiat', model: 'Argo' });
    const os = await createWorkOrder(t.app, dono, { customerId: cliente.id, vehicleId: veiculo.id, items: [{ type: 'SERVICE', serviceId: servicoId }] });
    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`);
    await post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
    expect((await post(`/api/v1/work-orders/${os.id}/start`)).statusCode).toBe(200);
    expect((await post(`/api/v1/work-orders/${os.id}/complete`)).statusCode).toBe(200);
    return os;
  }
  const emitir = (os: TestWorkOrder) => post(`/api/v1/work-orders/${os.id}/invoices`, { clientRequestId: randomUUID() });

  /** O que o script `nfse-focus ligar` grava: provider, ambiente, token cifrado e IBGE. */
  async function ligar(ibge: string | null) {
    await withTenant(testDb().db, { organizationId: dono.orgId }, (tx) =>
      tx
        .update(organizationFiscalSettings)
        .set({
          provider: 'focus',
          environment: 'HOMOLOGATION',
          providerTokenEnc: cifrar('token-da-oficina', testEnv().SECRETS_KEY),
          ibgeCityCode: ibge,
        })
        .where(eq(organizationFiscalSettings.organizationId, dono.orgId)),
    );
  }

  beforeAll(async () => {
    t = await createTestApp(
      { NFSE_ESPERA_MS: '0' },
      {
        emissorDaOficina: (opcoes) => {
          tokensRecebidos.push(opcoes);
          return emissor;
        },
      },
    );
    dono = await signup(t.app);
    const servico = await post('/api/v1/services', { name: 'Revisão completa', priceCents: 40_000 });
    servicoId = (servico.json() as { id: string }).id;
    const org = await t.app.inject({
      method: 'PATCH',
      url: '/api/v1/organization',
      headers: bearer(dono.accessToken),
      payload: {
        legalName: 'Oficina do Gabriel LTDA',
        document: '11.222.333/0001-81',
        address: { zip: '37701-238', street: 'Rua México', number: '237', complement: '', district: 'Centro', city: 'Poços de Caldas', state: 'MG' },
      },
    });
    expect(org.statusCode, org.body).toBe(200);
    const fiscal = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/fiscal-settings',
      headers: bearer(dono.accessToken),
      payload: { municipalRegistration: '123456', taxRegime: 'SIMPLES_NACIONAL', serviceListItem: '14.01', issRateBps: 300, rpsSeries: '1' },
    });
    expect(fiscal.statusCode, fiscal.body).toBe(200);
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('sem o código IBGE a nota nem sai, e a recusa diz o que falta', async () => {
    await ligar(null);
    const os = await osFinalizada();
    const r = await emitir(os);
    expect(r.statusCode, r.body).toBe(422);
    expect(r.body).toContain('ibgeCityCode');
    expect(emissor.pedidos, 'nada foi para a Focus').toHaveLength(0);
  });

  it('emite pela Focus com o token DESTA oficina, e a autorização que chega em segundos já volta na resposta', async () => {
    await ligar('3151800');
    emissor.consultaResponde = 'AUTHORIZED';
    const os = await osFinalizada();
    const r = await emitir(os);
    expect(r.statusCode, r.body).toBe(201);
    const nota = r.json() as Nota;
    expect(nota).toMatchObject({ status: 'AUTHORIZED', environment: 'HOMOLOGATION', provider: 'focus', invoiceNumber: '74798' });
    expect(tokensRecebidos.at(-1), 'o token sai do banco decifrado, só na hora').toEqual({
      token: 'token-da-oficina',
      environment: 'HOMOLOGATION',
    });
    expect(emissor.pedidos.at(-1)?.prestador.ibgeCityCode).toBe('3151800');
  });

  it('nota que fica na fila é consultada de novo quando a OS é lida, até a prefeitura responder', async () => {
    emissor.consultaResponde = 'QUEUED';
    const os = await osFinalizada();
    const r = await emitir(os);
    expect(r.statusCode, r.body).toBe(201);
    expect((r.json() as Nota).status, 'a prefeitura ainda não respondeu').toBe('QUEUED');

    const consultasAntes = emissor.consultas;
    emissor.consultaResponde = 'AUTHORIZED';
    const lista = (await get(`/api/v1/work-orders/${os.id}/invoices`)).json() as { data: Nota[] };
    expect(emissor.consultas).toBeGreaterThan(consultasAntes);
    expect(lista.data[0]).toMatchObject({ status: 'AUTHORIZED', invoiceNumber: '74798', pdfUrl: 'https://exemplo.invalido/danfse.pdf' });

    // autorizada não é consultada de novo a cada leitura
    const consultasDepois = emissor.consultas;
    await get(`/api/v1/work-orders/${os.id}/invoices`);
    expect(emissor.consultas).toBe(consultasDepois);
  });

  it('salvar a configuração fiscal pelo painel NÃO desliga o emissor (e o token nunca aparece)', async () => {
    const r = await t.app.inject({
      method: 'PUT',
      url: '/api/v1/fiscal-settings',
      headers: bearer(dono.accessToken),
      payload: { issRateBps: 350 },
    });
    expect(r.statusCode, r.body).toBe(200);
    const config = (await get('/api/v1/fiscal-settings')).json() as Record<string, unknown>;
    expect(config).toMatchObject({ provider: 'focus', environment: 'HOMOLOGATION', emissorConectado: true, ibgeCityCode: '3151800' });
    expect(JSON.stringify(config)).not.toContain('token');
  });

  it('cancela no mesmo emissor que emitiu; cancelamento recusado volta 422 com o motivo da prefeitura', async () => {
    emissor.consultaResponde = 'AUTHORIZED';
    const os = await osFinalizada();
    const nota = (await emitir(os)).json() as Nota;

    emissor.cancelamentoFalha = true;
    const recusado = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'Serviço lançado em duplicidade' });
    expect(recusado.statusCode, recusado.body).toBe(422);
    expect(recusado.body).toContain('Prazo de cancelamento expirado');

    emissor.cancelamentoFalha = false;
    const ok = await post(`/api/v1/invoices/${nota.id}/cancel`, { reason: 'Serviço lançado em duplicidade' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as Nota).status).toBe('CANCELED');
    expect(emissor.cancelamentos).toContain('Serviço lançado em duplicidade');
  });
});
