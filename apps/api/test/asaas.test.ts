import { describe, expect, it } from 'vitest';
import { AsaasPaymentGateway, statusDoAsaas } from '../src/integrations/payments';
import type { PedidoDeCobranca } from '../src/integrations/payments';

/**
 * Contrato do driver do Asaas (E19).
 *
 * O driver ainda **não foi exercitado contra a API real** — falta a conta. O
 * que dá para provar sem credencial, e é o que quebra na hora de ligar, está
 * aqui: o formato do que mandamos (reais, não centavos), a tradução do que
 * volta, e a recusa de aviso sem o token combinado.
 *
 * Um `fetch` falso registra cada chamada; nenhuma rede é tocada.
 */
interface Chamada {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function gatewayFalso(respostas: Record<string, unknown>, status = 200) {
  const chamadas: Chamada[] = [];
  const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
    const endereco = String(url);
    chamadas.push({
      url: endereco,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const caminho = endereco.replace('https://api-sandbox.asaas.com/v3', '');
    const corpo = respostas[`${init?.method ?? 'GET'} ${caminho}`] ?? respostas[caminho];
    return new Response(JSON.stringify(corpo ?? {}), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const gateway = new AsaasPaymentGateway({
    apiKey: 'chave-de-teste',
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    webhookToken: 'token-do-webhook',
    environment: 'SANDBOX',
    fetch: fetchFalso,
  });
  return { gateway, chamadas };
}

const PEDIDO: PedidoDeCobranca = {
  chargeId: '0199a0c0-0000-7000-8000-000000000001',
  method: 'PIX',
  amountCents: 68_000,
  dueDate: '2026-09-25',
  description: 'OS nº 182 — Oficina Teste',
  cliente: {
    id: '0199a0c0-0000-7000-8000-0000000000c1',
    name: 'João Pereira',
    document: '39053344705',
    email: 'joao@exemplo.invalido',
    phone: '11912345678',
    zip: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    providerCustomerId: null,
  },
};

describe('driver do Asaas', () => {
  it('cadastra o cliente, cria a cobrança em REAIS e busca o Pix', async () => {
    const { gateway, chamadas } = gatewayFalso({
      'POST /customers': { id: 'cus_000123' },
      'POST /payments': {
        id: 'pay_000456',
        status: 'PENDING',
        value: 680,
        invoiceUrl: 'https://sandbox.asaas.com/i/000456',
        bankSlipUrl: 'https://sandbox.asaas.com/b/000456',
      },
      'GET /payments/pay_000456/pixQrCode': { payload: '00020126...5204', encodedImage: 'iVBORw0KGgo=' },
    });

    const resposta = await gateway.criar(PEDIDO);

    expect(chamadas[0]!.url).toContain('/customers');
    expect(chamadas[0]!.headers.access_token, 'a chave vai no header, não na URL').toBe('chave-de-teste');
    expect((chamadas[0]!.body as { cpfCnpj: string }).cpfCnpj).toBe('39053344705');

    const cobranca = chamadas[1]!.body as { value: number; billingType: string; dueDate: string; externalReference: string };
    expect(cobranca.value, 'o Asaas fala em reais; nós, em centavos').toBe(680);
    expect(cobranca.billingType).toBe('PIX');
    expect(cobranca.dueDate).toBe('2026-09-25');
    expect(cobranca.externalReference, 'a nossa cobrança é a referência externa dele').toBe(PEDIDO.chargeId);

    expect(resposta.providerChargeId).toBe('pay_000456');
    expect(resposta.providerCustomerId).toBe('cus_000123');
    expect(resposta.status).toBe('PENDING');
    expect(resposta.pixPayload).toBe('00020126...5204');
    expect(resposta.pixQrImage).toBe('iVBORw0KGgo=');
    expect(resposta.paymentUrl).toBe('https://sandbox.asaas.com/i/000456');
  });

  it('cliente já cadastrado não é cadastrado de novo', async () => {
    const { gateway, chamadas } = gatewayFalso({
      'POST /payments': { id: 'pay_1', status: 'PENDING' },
      'GET /payments/pay_1/pixQrCode': {},
    });
    await gateway.criar({ ...PEDIDO, cliente: { ...PEDIDO.cliente, providerCustomerId: 'cus_ja_existe' } });
    expect(chamadas.some((chamada) => chamada.url.endsWith('/customers'))).toBe(false);
    expect((chamadas[0]!.body as { customer: string }).customer).toBe('cus_ja_existe');
  });

  it('centavo quebrado não vira dízima no caminho', async () => {
    const { gateway, chamadas } = gatewayFalso({
      'POST /customers': { id: 'cus_1' },
      'POST /payments': { id: 'pay_2', status: 'PENDING' },
      'GET /payments/pay_2/pixQrCode': {},
    });
    await gateway.criar({ ...PEDIDO, amountCents: 33_333 });
    expect((chamadas[1]!.body as { value: number }).value).toBe(333.33);
  });

  it('o QR que não vem não derruba a cobrança: o cliente ainda paga pelo link', async () => {
    let primeira = true;
    const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/pixQrCode')) return new Response('erro', { status: 500 });
      const corpo = primeira ? { id: 'cus_1' } : { id: 'pay_3', status: 'PENDING', invoiceUrl: 'https://x/y' };
      primeira = false;
      void init;
      return new Response(JSON.stringify(corpo), { status: 200 });
    }) as typeof fetch;
    const gateway = new AsaasPaymentGateway({
      apiKey: 'k',
      baseUrl: 'https://api-sandbox.asaas.com/v3',
      webhookToken: 't',
      environment: 'SANDBOX',
      fetch: fetchFalso,
    });
    const resposta = await gateway.criar(PEDIDO);
    expect(resposta.providerChargeId).toBe('pay_3');
    expect(resposta.pixPayload).toBeNull();
    expect(resposta.paymentUrl).toBe('https://x/y');
  });

  it('erro do gateway sobe com a mensagem legível dele', async () => {
    const fetchFalso = (async () =>
      new Response(JSON.stringify({ errors: [{ description: 'O CPF informado é inválido.' }] }), {
        status: 400,
      })) as typeof fetch;
    const gateway = new AsaasPaymentGateway({
      apiKey: 'k',
      baseUrl: 'https://api-sandbox.asaas.com/v3',
      webhookToken: 't',
      environment: 'SANDBOX',
      fetch: fetchFalso,
    });
    await expect(gateway.criar(PEDIDO)).rejects.toThrow('O CPF informado é inválido.');
  });

  // ------------------------------- avisos -------------------------------

  const AVISO = JSON.stringify({
    id: 'evt_0001',
    event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay_000456', status: 'RECEIVED', value: 680, paymentDate: '2026-09-21' },
  });

  it('aviso sem o token combinado é recusado: dinheiro não se aceita de desconhecido', () => {
    const { gateway } = gatewayFalso({});
    expect(() => gateway.lerAviso({}, AVISO)).toThrow(/token/i);
    expect(() => gateway.lerAviso({ 'asaas-access-token': 'errado' }, AVISO)).toThrow(/token/i);
  });

  it('aviso com o token traduz a cobrança paga', () => {
    const { gateway } = gatewayFalso({});
    const aviso = gateway.lerAviso({ 'asaas-access-token': 'token-do-webhook' }, AVISO)!;
    expect(aviso.externalId, 'é o id do EVENTO que impede processar duas vezes').toBe('evt_0001');
    expect(aviso.providerChargeId).toBe('pay_000456');
    expect(aviso.status).toBe('PAID');
    expect(aviso.paidAmountCents).toBe(68_000);
    expect(aviso.paidAt).toBeInstanceOf(Date);
  });

  it('aviso que não é de cobrança é ignorado', () => {
    const { gateway } = gatewayFalso({});
    const corpo = JSON.stringify({ id: 'evt_2', event: 'SUBSCRIPTION_CREATED', payment: { id: 'x', status: 'PENDING' } });
    expect(gateway.lerAviso({ 'asaas-access-token': 'token-do-webhook' }, corpo)).toBeNull();
  });

  it('situação desconhecida do gateway nunca vira "pago"', () => {
    expect(statusDoAsaas('RECEIVED')).toBe('PAID');
    expect(statusDoAsaas('CONFIRMED')).toBe('PAID');
    expect(statusDoAsaas('OVERDUE')).toBe('EXPIRED');
    expect(statusDoAsaas('DELETED')).toBe('CANCELED');
    expect(statusDoAsaas('REFUNDED')).toBe('REFUNDED');
    expect(statusDoAsaas('CHARGEBACK_REQUESTED')).toBe('FAILED');
    expect(statusDoAsaas('COISA_NOVA_QUE_INVENTARAM')).toBe('FAILED');
  });
});
