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

interface Cobranca {
  id: string;
  method: string;
  status: string;
  environment: string;
  provider: string;
  amountCents: number;
  dueDate: string;
  pixPayload: string | null;
  pixQrImage: string | null;
  paymentUrl: string | null;
  paidAmountCents: number | null;
  paymentId: string | null;
  cancelReason: string | null;
}

interface Resumo {
  charges: Cobranca[];
  environment: string;
  provider: string;
  balanceCents: number;
  pendingCents: number;
  availableCents: number;
  whatsappUrl: string | null;
}

/**
 * Cobrança online (V3, E19).
 *
 * O que precisa ficar provado aqui: o teto da cobrança (saldo menos o que já
 * está pendurado), o aviso do gateway virando pagamento no MESMO caixa do
 * dinheiro da mão, o aviso repetido não dando baixa duas vezes, e o estorno
 * desfazendo o pagamento.
 *
 * O gateway é o **simulador**: não cria cobrança em lugar nenhum. Por isso
 * todo teste confere `environment: 'SIMULATOR'` e `paymentUrl: null`.
 */
describe('cobrança online', () => {
  let t: TestApp;
  let dono: TestSession;
  let atendente: TestSession;
  let servicoId: string;
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });

  /** OS finalizada de R$ 400 (serviço), pelo caminho normal: orçamento aprovado. */
  async function osParaCobrar(): Promise<TestWorkOrder> {
    const cliente = await createCustomer(t.app, dono, { name: 'João Pereira', whatsapp: '(11) 91234-5678' });
    const veiculo = await createVehicle(t.app, dono, cliente.id, { plate: `COB${sequencia++}A23`.slice(0, 7) });
    const os = await createWorkOrder(t.app, dono, {
      customerId: cliente.id,
      vehicleId: veiculo.id,
      items: [{ type: 'SERVICE', serviceId: servicoId }],
    });
    const orcamento = await post(`/api/v1/work-orders/${os.id}/quotes`, {});
    await post(`/api/v1/quotes/${(orcamento.json() as { id: string }).id}/manual-decision`, {
      decision: 'APPROVED',
      channel: 'PHONE',
    });
    await post(`/api/v1/work-orders/${os.id}/start`);
    await post(`/api/v1/work-orders/${os.id}/complete`);
    return os;
  }

  const cobrar = (os: TestWorkOrder, payload: Record<string, unknown> = {}, s: TestSession = dono) =>
    post(`/api/v1/work-orders/${os.id}/charges`, {
      clientRequestId: randomUUID(),
      method: 'PIX',
      amountCents: 40_000,
      ...payload,
    }, s);

  /** O aviso que o gateway manda quando o dinheiro cai. */
  const avisar = (providerChargeId: string, extra: Record<string, unknown> = {}) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/payments/simulador',
      payload: { event: 'PAYMENT_RECEIVED', providerChargeId, ...extra },
    });

  async function refDoGateway(os: TestWorkOrder): Promise<string> {
    const resumo = (await get(`/api/v1/work-orders/${os.id}/charges`)).json() as Resumo;
    const cobranca = resumo.charges[0]!;
    // o simulador deriva a referência do id da cobrança (hash determinístico)
    const { createHash } = await import('node:crypto');
    return `sim-${createHash('sha256').update(cobranca.id).digest('hex').slice(0, 16)}`;
  }

  beforeAll(async () => {
    t = await createTestApp();
    dono = await signup(t.app);
    atendente = await addMember(t.app, dono, 'ATTENDANT', 'Ana Atendente');
    servicoId = ((await post('/api/v1/services', { name: 'Revisão completa', priceCents: 40_000 })).json() as { id: string }).id;
  });
  afterAll(async () => {
    await t.app.close();
  });

  // ------------------------------- criação -------------------------------

  it('cria a cobrança do saldo da OS, marcada como simulação', async () => {
    const os = await osParaCobrar();
    const res = await cobrar(os);
    expect(res.statusCode, res.body).toBe(201);
    const resumo = res.json() as Resumo;

    expect(resumo.charges).toHaveLength(1);
    const cobranca = resumo.charges[0]!;
    expect(cobranca.status).toBe('PENDING');
    expect(cobranca.environment, 'o simulador não cobra ninguém').toBe('SIMULATOR');
    expect(cobranca.paymentUrl, 'e por isso não inventa link de pagamento').toBeNull();
    expect(cobranca.pixQrImage, 'nem QR de Pix').toBeNull();
    expect(cobranca.pixPayload, 'o "copia e cola" sai declarado como simulação').toContain('SIMULACAO');
    expect(cobranca.amountCents).toBe(40_000);

    expect(resumo.balanceCents).toBe(40_000);
    expect(resumo.pendingCents, 'o valor fica pendurado até pagar ou cancelar').toBe(40_000);
    expect(resumo.availableCents, 'e some do teto da próxima cobrança').toBe(0);
  });

  it('não dá para cobrar duas vezes o mesmo saldo', async () => {
    const os = await osParaCobrar();
    expect((await cobrar(os, { amountCents: 30_000 })).statusCode).toBe(201);

    const demais = await cobrar(os, { amountCents: 20_000 });
    expect(demais.statusCode, demais.body).toBe(422);
    const corpo = demais.json() as { code: string; detail: string };
    expect(corpo.code).toBe('PAYMENT_EXCEEDS_BALANCE');
    // o Intl usa espaço inquebrável entre "R$" e o número
    expect(corpo.detail.replace(new RegExp(String.fromCharCode(0x00a0), 'g'), ' ')).toContain('R$ 100,00');

    // o que sobra do saldo ainda pode ser cobrado
    expect((await cobrar(os, { amountCents: 10_000 })).statusCode).toBe(201);
  });

  it('o mesmo pedido repetido não cria duas cobranças', async () => {
    const os = await osParaCobrar();
    const clientRequestId = randomUUID();
    await cobrar(os, { clientRequestId, amountCents: 10_000 });
    const segunda = await cobrar(os, { clientRequestId, amountCents: 10_000 });
    expect(segunda.statusCode, segunda.body).toBe(201);
    expect((segunda.json() as Resumo).charges).toHaveLength(1);
  });

  it('OS cancelada não gera cobrança', async () => {
    const os = await osParaCobrar();
    await post(`/api/v1/work-orders/${os.id}/cancel`, { reason: 'Cliente desistiu' });
    const res = await cobrar(os);
    expect(res.statusCode, res.body).toBe(422);
  });

  it('o mecânico não cobra ninguém', async () => {
    const mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
    const os = await osParaCobrar();
    expect((await cobrar(os, {}, mecanico)).statusCode).toBe(403);
    // o atendente é o caixa: esse cobra
    expect((await cobrar(os, {}, atendente)).statusCode).toBe(201);
  });

  // ----------------------------- conciliação ------------------------------

  it('o aviso do gateway vira pagamento no caixa da OS, uma vez só', async () => {
    const os = await osParaCobrar();
    await cobrar(os);
    const ref = await refDoGateway(os);

    const aviso = await avisar(ref, { amountCents: 40_000, externalId: `evt-${ref}` });
    expect(aviso.statusCode, aviso.body).toBe(200);
    expect((aviso.json() as { handled: boolean }).handled).toBe(true);

    const resumo = (await get(`/api/v1/work-orders/${os.id}/charges`)).json() as Resumo;
    const cobranca = resumo.charges[0]!;
    expect(cobranca.status).toBe('PAID');
    expect(cobranca.paidAmountCents).toBe(40_000);
    expect(cobranca.paymentId, 'a cobrança guarda o pagamento que ela criou').toBeTruthy();
    expect(resumo.balanceCents, 'a OS ficou paga').toBe(0);

    // o dinheiro entrou no MESMO caixa do pagamento de balcão
    const caixa = (await get(`/api/v1/work-orders/${os.id}/payments`)).json() as {
      data: { method: string; amountCents: number; provider: string | null }[];
      paidCents: number;
      balanceCents: number;
    };
    expect(caixa.data).toHaveLength(1);
    expect(caixa.data[0]!.method).toBe('PIX');
    expect(caixa.data[0]!.provider).toBe('simulador');
    expect(caixa.paidCents).toBe(40_000);
    expect(caixa.balanceCents).toBe(0);

    // e a OS conta a história
    const os_ = (await get(`/api/v1/work-orders/${os.number}`)).json() as { paymentStatus: string };
    expect(os_.paymentStatus).toBe('PAID');

    // o gateway REENVIA o mesmo aviso até receber 200: o id do evento barra
    const repetido = await avisar(ref, { amountCents: 40_000, externalId: `evt-${ref}` });
    expect(repetido.statusCode).toBe(200);
    const repetidoCorpo = repetido.json() as { handled: boolean; reason: string };
    expect(repetidoCorpo.handled).toBe(false);
    expect(repetidoCorpo.reason, 'barrado pelo id do evento, antes de olhar a cobrança').toBe('aviso repetido');

    // e um aviso DIFERENTE sobre a mesma cobrança também não dobra nada: a
    // segunda trava é a situação da própria cobrança
    const outroEvento = await avisar(ref, { amountCents: 40_000, externalId: `evt-2-${ref}` });
    expect((outroEvento.json() as { reason: string }).reason).toBe('cobrança já estava paga');
    const depois = (await get(`/api/v1/work-orders/${os.id}/payments`)).json() as { data: unknown[]; paidCents: number };
    expect(depois.data, 'um pagamento, não dois').toHaveLength(1);
    expect(depois.paidCents).toBe(40_000);
  });

  it('aviso de cobrança que não é nossa não derruba nem inventa dinheiro', async () => {
    const res = await avisar('sim-cobranca-de-outro-sistema');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { handled: boolean }).handled).toBe(false);
  });

  // -------------------------- cancelar e estornar --------------------------

  it('cancelar exige motivo e só vale antes de pagar', async () => {
    const os = await osParaCobrar();
    const resumo = (await cobrar(os)).json() as Resumo;
    const cobranca = resumo.charges[0]!;

    expect((await post(`/api/v1/charges/${cobranca.id}/cancel`, { reason: 'x' })).statusCode).toBe(400);

    const cancelou = await post(`/api/v1/charges/${cobranca.id}/cancel`, { reason: 'Cliente vai pagar na loja' });
    expect(cancelou.statusCode, cancelou.body).toBe(200);
    const depois = cancelou.json() as Resumo;
    expect(depois.charges[0]!.status).toBe('CANCELED');
    expect(depois.charges[0]!.cancelReason).toBe('Cliente vai pagar na loja');
    expect(depois.availableCents, 'cancelou, o valor volta a poder ser cobrado').toBe(40_000);

    expect((await post(`/api/v1/charges/${cobranca.id}/cancel`, { reason: 'De novo não' })).statusCode).toBe(409);
  });

  it('cobrança paga não se cancela: se estorna, e o caixa volta atrás', async () => {
    const os = await osParaCobrar();
    await cobrar(os);
    const ref = await refDoGateway(os);
    await avisar(ref, { amountCents: 40_000, externalId: `evt-pago-${ref}` });

    const resumo = (await get(`/api/v1/work-orders/${os.id}/charges`)).json() as Resumo;
    const paga = resumo.charges[0]!;
    expect((await post(`/api/v1/charges/${paga.id}/cancel`, { reason: 'Não era para ter pago' })).statusCode).toBe(422);

    // atendente não estorna: devolver dinheiro é de outro nível
    expect((await post(`/api/v1/charges/${paga.id}/refund`, {}, atendente)).statusCode).toBe(403);

    const estorno = await post(`/api/v1/charges/${paga.id}/refund`, {});
    expect(estorno.statusCode, estorno.body).toBe(200);
    expect((estorno.json() as Resumo).charges[0]!.status).toBe('REFUNDED');

    const caixa = (await get(`/api/v1/work-orders/${os.id}/payments`)).json() as {
      data: { status: string }[];
      paidCents: number;
      balanceCents: number;
    };
    expect(caixa.data[0]!.status, 'o pagamento fica cancelado, não some').toBe('CANCELED');
    expect(caixa.paidCents).toBe(0);
    expect(caixa.balanceCents, 'e a OS volta a dever').toBe(40_000);
  });
});
