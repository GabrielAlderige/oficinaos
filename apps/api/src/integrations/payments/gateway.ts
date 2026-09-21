import { createHash } from 'node:crypto';
import type { BillingCycle, ChargeMethod, ChargeStatus, PaymentEnvironment } from '@oficinaos/shared';

/**
 * Cobrança online atrás de uma interface (ARCHITECTURE §12), como o e-mail, o
 * storage e a nota fiscal. O domínio monta o pedido, guarda a resposta e
 * concilia o aviso; ele não sabe quem é o gateway.
 *
 * Dois drivers:
 *   simulador → não move dinheiro nenhum; existe para percorrer o fluxo
 *   asaas     → Pix, boleto e cartão de verdade, com a chave da oficina
 */

export interface PedidoDeCobranca {
  chargeId: string;
  method: ChargeMethod;
  amountCents: number;
  /** 'YYYY-MM-DD' */
  dueDate: string;
  description: string;
  cliente: {
    id: string;
    name: string;
    document: string | null;
    email: string | null;
    phone: string | null;
    zip: string | null;
    street: string | null;
    number: string | null;
    district: string | null;
    city: string | null;
    state: string | null;
    /** id do cliente no gateway, quando já foi cadastrado antes */
    providerCustomerId: string | null;
  };
}

export interface RespostaDaCobranca {
  providerChargeId: string;
  providerCustomerId: string | null;
  status: ChargeStatus;
  paymentUrl: string | null;
  pixPayload: string | null;
  /** PNG em base64, como o gateway devolveu */
  pixQrImage: string | null;
  boletoUrl: string | null;
  barcode: string | null;
  raw: Record<string, unknown>;
}

/** O que um aviso do gateway diz, já traduzido para o nosso vocabulário. */
export interface AvisoDeCobranca {
  /** id do EVENTO no gateway: é ele que impede processar o mesmo aviso duas vezes */
  externalId: string;
  eventType: string;
  providerChargeId: string;
  /** preenchido quando a cobrança nasceu de uma assinatura (E20) */
  providerSubscriptionId: string | null;
  status: ChargeStatus;
  paidAmountCents: number | null;
  paidAt: Date | null;
  failureReason: string | null;
  raw: Record<string, unknown>;
}

/** Assinatura do SaaS (E20): a oficina vira cliente recorrente do gateway. */
export interface PedidoDeAssinatura {
  /** o id da oficina: é a referência externa da assinatura no gateway */
  organizationId: string;
  amountCents: number;
  cycle: BillingCycle;
  description: string;
  /** 'YYYY-MM-DD': quando a primeira (ou próxima) cobrança vence */
  nextDueDate: string;
  cliente: {
    name: string;
    document: string | null;
    email: string | null;
    phone: string | null;
    providerCustomerId: string | null;
  };
}

export interface RespostaDaAssinatura {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  /** a página onde a oficina paga; `null` no simulador */
  checkoutUrl: string | null;
  raw: Record<string, unknown>;
}

export interface PaymentGateway {
  readonly driver: string;
  readonly environment: PaymentEnvironment;
  criar(pedido: PedidoDeCobranca): Promise<RespostaDaCobranca>;
  cancelar(providerChargeId: string): Promise<{ raw: Record<string, unknown> }>;
  estornar(providerChargeId: string, amountCents: number): Promise<{ raw: Record<string, unknown> }>;
  /**
   * Lê o aviso do gateway. Devolve `null` quando o aviso não interessa (evento
   * de outro tipo). **Lança** quando a autenticação do aviso não confere: aviso
   * sem origem confiável é dinheiro inventado.
   */
  lerAviso(headers: Record<string, string | string[] | undefined>, rawBody: string): AvisoDeCobranca | null;
  criarAssinatura(pedido: PedidoDeAssinatura): Promise<RespostaDaAssinatura>;
  atualizarAssinatura(
    providerSubscriptionId: string,
    mudanca: { amountCents: number; cycle: BillingCycle; description: string },
  ): Promise<{ raw: Record<string, unknown> }>;
  cancelarAssinatura(providerSubscriptionId: string): Promise<{ raw: Record<string, unknown> }>;
}

/**
 * Simulador. Não cria cobrança em lugar nenhum: devolve uma referência
 * determinística (hash do id) para o fluxo inteiro poder ser percorrido e
 * testado. Ele:
 *
 * - **não** devolve link de pagamento nem QR (`null`), porque Pix falso é o
 *   tipo de coisa que não se inventa: a tela mostra o aviso no lugar;
 * - devolve o "copia e cola" só como texto declarado de simulação;
 * - aceita um aviso "pago" pela rota de webhook, para a oficina ver a baixa
 *   acontecer antes de contratar o gateway.
 */
export class SimuladorPaymentGateway implements PaymentGateway {
  readonly driver = 'simulador';
  readonly environment: PaymentEnvironment = 'SIMULATOR';

  async criar(pedido: PedidoDeCobranca): Promise<RespostaDaCobranca> {
    const digest = createHash('sha256').update(pedido.chargeId).digest('hex');
    return {
      providerChargeId: `sim-${digest.slice(0, 16)}`,
      providerCustomerId: `sim-cli-${pedido.cliente.id.slice(0, 8)}`,
      status: 'PENDING',
      paymentUrl: null,
      pixPayload:
        pedido.method === 'PIX' || pedido.method === 'LINK'
          ? `SIMULACAO-NAO-E-PIX-VALIDO-${digest.slice(0, 24).toUpperCase()}`
          : null,
      pixQrImage: null,
      boletoUrl: null,
      barcode: null,
      raw: { simulacao: true, aviso: 'Nenhuma cobrança foi criada em gateway nenhum.' },
    };
  }

  async cancelar(providerChargeId: string) {
    return { raw: { simulacao: true, cancelada: providerChargeId } };
  }

  async estornar(providerChargeId: string, amountCents: number) {
    return { raw: { simulacao: true, estornada: providerChargeId, amountCents } };
  }

  async criarAssinatura(pedido: PedidoDeAssinatura): Promise<RespostaDaAssinatura> {
    const digest = createHash('sha256').update(`assinatura:${pedido.organizationId}`).digest('hex');
    return {
      providerSubscriptionId: `sim-sub-${digest.slice(0, 16)}`,
      providerCustomerId: `sim-cli-${digest.slice(16, 24)}`,
      checkoutUrl: null,
      raw: { simulacao: true, aviso: 'Nenhuma assinatura foi criada em gateway nenhum.', ciclo: pedido.cycle },
    };
  }

  async atualizarAssinatura(providerSubscriptionId: string, mudanca: { amountCents: number; cycle: BillingCycle }) {
    return { raw: { simulacao: true, assinatura: providerSubscriptionId, ...mudanca } };
  }

  async cancelarAssinatura(providerSubscriptionId: string) {
    return { raw: { simulacao: true, cancelada: providerSubscriptionId } };
  }

  /**
   * No simulador o "aviso" vem da própria oficina, pela rota de webhook, para
   * ver a conciliação funcionar. O corpo é o nosso, não o de um gateway.
   */
  lerAviso(_headers: Record<string, string | string[] | undefined>, rawBody: string): AvisoDeCobranca | null {
    const corpo = JSON.parse(rawBody) as {
      event?: string;
      providerChargeId?: string;
      providerSubscriptionId?: string;
      externalId?: string;
      amountCents?: number;
    };
    if (!corpo.providerChargeId) return null;
    const evento = corpo.event ?? 'PAYMENT_RECEIVED';
    const situacoes: Record<string, ChargeStatus> = {
      PAYMENT_RECEIVED: 'PAID',
      PAYMENT_OVERDUE: 'EXPIRED',
      PAYMENT_REFUNDED: 'REFUNDED',
    };
    const status = situacoes[evento];
    if (!status) return null;
    return {
      externalId: corpo.externalId ?? `sim-evt-${corpo.providerChargeId}`,
      eventType: evento,
      providerChargeId: corpo.providerChargeId,
      providerSubscriptionId: corpo.providerSubscriptionId ?? null,
      status,
      paidAmountCents: status === 'PAID' ? (corpo.amountCents ?? null) : null,
      paidAt: status === 'PAID' ? new Date() : null,
      failureReason: null,
      raw: { ...corpo, simulacao: true },
    };
  }
}
