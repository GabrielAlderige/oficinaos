import { timingSafeEqual } from 'node:crypto';
import type { BillingCycle, ChargeStatus, PaymentEnvironment } from '@oficinaos/shared';
import type {
  AvisoDeCobranca,
  PaymentGateway,
  PedidoDeAssinatura,
  PedidoDeCobranca,
  RespostaDaAssinatura,
  RespostaDaCobranca,
} from './gateway';

/**
 * Asaas (E19). Gateway brasileiro de PME: Pix, boleto e cartão numa API só, e
 * cobrança recorrente para a assinatura do SaaS (E20) sem outro contrato.
 *
 * **O que já rodou contra o Asaas de verdade** (sandbox, 07/10/2026): a
 * ASSINATURA inteira — cliente, assinatura, primeira fatura, pagamento
 * simulado e o aviso montado com a cobrança real que o Asaas devolveu, que
 * ativou o plano; e o aviso com token errado recusado. Saíram de lá o CPF/CNPJ
 * obrigatório e o período contado do vencimento. A cobrança da OFICINA para o
 * cliente (`criar`, `cancelar`, `estornar`) segue só com testes de contrato
 * (`asaas.test.ts`): fica desligada enquanto a conta for uma só.
 *
 * O dinheiro no Asaas é decimal em reais; aqui é centavo inteiro. A conversão
 * acontece só na borda, nas duas funções abaixo.
 */

const reais = (cents: number): number => Number((cents / 100).toFixed(2));
const centavos = (valor: number | null | undefined): number | null =>
  valor === null || valor === undefined ? null : Math.round(valor * 100);

/** Situação do Asaas → a nossa. O que não conhecemos vira falha, nunca "pago". */
export function statusDoAsaas(status: string): ChargeStatus {
  switch (status) {
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'PENDING';
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'PAID';
    case 'OVERDUE':
      return 'EXPIRED';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
      return 'REFUNDED';
    case 'DELETED':
      return 'CANCELED';
    default:
      return 'FAILED';
  }
}

const BILLING_TYPE = {
  PIX: 'PIX',
  BOLETO: 'BOLETO',
  CREDIT_CARD: 'CREDIT_CARD',
  LINK: 'UNDEFINED',
} as const;

interface AsaasCustomer {
  id: string;
}

interface AsaasPayment {
  id: string;
  status: string;
  value?: number;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  identificationField?: string;
  dueDate?: string;
  paymentDate?: string;
  clientPaymentDate?: string;
}

interface AsaasPixQrCode {
  encodedImage?: string;
  payload?: string;
}

export interface AsaasConfig {
  apiKey: string;
  baseUrl: string;
  /** o token que a gente configura no painel do Asaas e ele repete em todo aviso */
  webhookToken: string;
  environment: PaymentEnvironment;
  fetch?: typeof fetch;
}

export class AsaasPaymentGateway implements PaymentGateway {
  readonly driver = 'asaas';
  readonly environment: PaymentEnvironment;
  private readonly http: typeof fetch;

  constructor(private readonly config: AsaasConfig) {
    this.environment = config.environment;
    this.http = config.fetch ?? fetch;
  }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const resposta = await this.http(`${this.config.baseUrl}${caminho}`, {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        // contas criadas depois de jun/2024 recusam chamada sem User-Agent
        'user-agent': 'OficinaOS',
        access_token: this.config.apiKey,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    if (!resposta.ok) {
      // a mensagem do Asaas vem em errors[].description e é legível: ela sobe
      // para a tela, porque "erro no gateway" não ajuda ninguém
      let detalhe = texto;
      try {
        const json = JSON.parse(texto) as { errors?: { description?: string }[] };
        detalhe = json.errors?.map((erro) => erro.description).filter(Boolean).join('; ') || texto;
      } catch {
        /* resposta sem JSON: fica o texto cru mesmo */
      }
      throw new Error(`Asaas ${metodo} ${caminho} devolveu ${resposta.status}: ${detalhe}`);
    }
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  /** O cliente precisa existir no gateway antes da cobrança. */
  private async garantirCliente(cliente: PedidoDeCobranca['cliente']): Promise<string> {
    if (cliente.providerCustomerId) return cliente.providerCustomerId;
    const criado = await this.chamar<AsaasCustomer>('POST', '/customers', {
      name: cliente.name,
      cpfCnpj: cliente.document ?? undefined,
      email: cliente.email ?? undefined,
      mobilePhone: cliente.phone ?? undefined,
      postalCode: cliente.zip ?? undefined,
      address: cliente.street ?? undefined,
      addressNumber: cliente.number ?? undefined,
      province: cliente.district ?? undefined,
      externalReference: cliente.id,
      notificationDisabled: false,
    });
    await this.soPorEmail(criado.id);
    return criado.id;
  }

  /**
   * Cliente novo no Asaas nasce com SMS e ligação de robô ligados nos avisos
   * de cobrança, e esses canais são COBRADOS por envio (o e-mail é grátis).
   * Desliga os pagos logo depois de criar, antes da primeira cobrança: o aviso
   * de "cobrança criada" sai no momento em que ela nasce.
   *
   * Falhar aqui não derruba a venda: a cobrança segue, só com os avisos padrão.
   */
  private async soPorEmail(providerCustomerId: string): Promise<void> {
    try {
      const lista = await this.chamar<{ data?: { id: string }[] }>(
        'GET',
        `/customers/${providerCustomerId}/notifications`,
      );
      const avisos = lista.data ?? [];
      if (!avisos.length) return;
      await this.chamar('PUT', '/notifications/batch', {
        customer: providerCustomerId,
        notifications: avisos.map((aviso) => ({
          id: aviso.id,
          smsEnabledForCustomer: false,
          phoneCallEnabledForCustomer: false,
          whatsappEnabledForCustomer: false,
          smsEnabledForProvider: false,
        })),
      });
    } catch {
      /* segue com os avisos padrão do Asaas */
    }
  }

  async criar(pedido: PedidoDeCobranca): Promise<RespostaDaCobranca> {
    const providerCustomerId = await this.garantirCliente(pedido.cliente);
    const cobranca = await this.chamar<AsaasPayment>('POST', '/payments', {
      customer: providerCustomerId,
      billingType: BILLING_TYPE[pedido.method],
      value: reais(pedido.amountCents),
      dueDate: pedido.dueDate,
      description: pedido.description,
      externalReference: pedido.chargeId,
    });

    // o Pix vem em outra chamada; se ela falhar, a cobrança já existe e o
    // cliente ainda pode pagar pelo link — não vale derrubar tudo por causa
    // do QR
    let pix: AsaasPixQrCode = {};
    if (pedido.method === 'PIX' || pedido.method === 'LINK') {
      try {
        pix = await this.chamar<AsaasPixQrCode>('GET', `/payments/${cobranca.id}/pixQrCode`);
      } catch {
        pix = {};
      }
    }

    return {
      providerChargeId: cobranca.id,
      providerCustomerId,
      status: statusDoAsaas(cobranca.status),
      paymentUrl: cobranca.invoiceUrl ?? null,
      pixPayload: pix.payload ?? null,
      pixQrImage: pix.encodedImage ?? null,
      boletoUrl: cobranca.bankSlipUrl ?? null,
      barcode: cobranca.identificationField ?? null,
      raw: cobranca as unknown as Record<string, unknown>,
    };
  }

  async cancelar(providerChargeId: string) {
    const raw = await this.chamar<Record<string, unknown>>('DELETE', `/payments/${providerChargeId}`);
    return { raw };
  }

  async estornar(providerChargeId: string, amountCents: number) {
    const raw = await this.chamar<Record<string, unknown>>('POST', `/payments/${providerChargeId}/refund`, {
      value: reais(amountCents),
    });
    return { raw };
  }

  // ----------------------------- assinatura ------------------------------

  async criarAssinatura(pedido: PedidoDeAssinatura): Promise<RespostaDaAssinatura> {
    let providerCustomerId = pedido.cliente.providerCustomerId;
    if (!providerCustomerId) {
      providerCustomerId = (
        await this.chamar<AsaasCustomer>('POST', '/customers', {
          name: pedido.cliente.name,
          cpfCnpj: pedido.cliente.document ?? undefined,
          email: pedido.cliente.email ?? undefined,
          mobilePhone: pedido.cliente.phone ?? undefined,
          externalReference: pedido.organizationId,
        })
      ).id;
      await this.soPorEmail(providerCustomerId);
    }

    const assinatura = await this.chamar<{ id: string }>('POST', '/subscriptions', {
      customer: providerCustomerId,
      // o cliente escolhe como pagar na página do gateway
      billingType: 'UNDEFINED',
      value: reais(pedido.amountCents),
      nextDueDate: pedido.nextDueDate,
      cycle: pedido.cycle,
      description: pedido.description,
      externalReference: pedido.organizationId,
    });

    return {
      providerSubscriptionId: assinatura.id,
      providerCustomerId,
      // a página de pagamento da PRIMEIRA cobrança da assinatura
      checkoutUrl: await this.primeiraFatura(assinatura.id),
      raw: assinatura as unknown as Record<string, unknown>,
    };
  }

  /** A fatura mais próxima da assinatura: é para lá que a oficina vai pagar. */
  private async primeiraFatura(providerSubscriptionId: string): Promise<string | null> {
    try {
      const lista = await this.chamar<{ data?: AsaasPayment[] }>(
        'GET',
        `/subscriptions/${providerSubscriptionId}/payments`,
      );
      return lista.data?.[0]?.invoiceUrl ?? null;
    } catch {
      // sem a fatura a assinatura existe do mesmo jeito; a tela mostra o aviso
      return null;
    }
  }

  async atualizarAssinatura(
    providerSubscriptionId: string,
    mudanca: { amountCents: number; cycle: BillingCycle; description: string },
  ) {
    const raw = await this.chamar<Record<string, unknown>>('PUT', `/subscriptions/${providerSubscriptionId}`, {
      value: reais(mudanca.amountCents),
      cycle: mudanca.cycle,
      description: mudanca.description,
      // a mudança vale da próxima cobrança em diante, não remarca o que já foi
      updatePendingPayments: true,
    });
    return { raw };
  }

  async cancelarAssinatura(providerSubscriptionId: string) {
    const raw = await this.chamar<Record<string, unknown>>('DELETE', `/subscriptions/${providerSubscriptionId}`);
    return { raw };
  }

  lerAviso(headers: Record<string, string | string[] | undefined>, rawBody: string): AvisoDeCobranca | null {
    const recebido = headers['asaas-access-token'];
    const token = Array.isArray(recebido) ? recebido[0] : recebido;
    if (!confere(token, this.config.webhookToken)) {
      throw new Error('Aviso do Asaas sem o token combinado');
    }

    const corpo = JSON.parse(rawBody) as {
      id?: string;
      event?: string;
      payment?: AsaasPayment & { subscription?: string };
    };
    const cobranca = corpo.payment;
    if (!corpo.event || !cobranca?.id) return null;
    // só evento de cobrança interessa; assinatura e transferência são outra história
    if (!corpo.event.startsWith('PAYMENT_')) return null;

    const status = statusDoAsaas(cobranca.status);
    const quando = cobranca.paymentDate ?? cobranca.clientPaymentDate ?? null;
    return {
      externalId: corpo.id ?? `${corpo.event}:${cobranca.id}`,
      eventType: corpo.event,
      providerChargeId: cobranca.id,
      providerSubscriptionId: cobranca.subscription ?? null,
      status,
      paidAmountCents: status === 'PAID' ? centavos(cobranca.value) : null,
      paidAt: status === 'PAID' ? (quando ? new Date(`${quando}T12:00:00-03:00`) : new Date()) : null,
      dueDate: cobranca.dueDate ?? null,
      invoiceUrl: cobranca.invoiceUrl ?? null,
      failureReason: status === 'FAILED' ? `Situação ${cobranca.status} no gateway` : null,
      raw: corpo as unknown as Record<string, unknown>,
    };
  }
}

/** Comparação em tempo constante: token de webhook não se compara com `===`. */
function confere(recebido: string | undefined, esperado: string): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
