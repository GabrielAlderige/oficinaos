import type { PosChargeStatus, PosMethod } from '@oficinaos/shared';

/**
 * A maquininha (E50): o sistema manda o pedido, a maquininha cobra, e a
 * situação volta pela consulta (ou pelo aviso, que só serve de "olhe agora").
 *
 * Driver real: Connect Stone 2.0, que é a API de pedidos da Pagar.me com o
 * `poi_payment_settings` apontando para o número de série da maquininha
 * ("pedido direto": a maquininha já abre na tela de pagamento).
 */

export interface PedidoParaMaquininha {
  /** o id da cobrança aqui: vai como `code` do pedido, para achar um no outro */
  ref: string;
  amountCents: number;
  description: string;
  method: PosMethod;
  installments: number;
  deviceSerial: string;
  /** o que aparece na tela da maquininha (ex.: "OS 123") */
  displayName: string;
  customer: { name: string; email: string };
}

export interface SituacaoNaMaquininha {
  status: PosChargeStatus;
  paidAmountCents: number | null;
  paidAt: Date | null;
  chargeId: string | null;
  cardBrand: string | null;
  authorizationCode: string | null;
  failureReason: string | null;
  raw: Record<string, unknown>;
}

export interface Maquininha {
  readonly driver: string;
  readonly environment: 'SIMULATOR' | 'PRODUCTION';
  criar(pedido: PedidoParaMaquininha): Promise<{ orderId: string; raw: Record<string, unknown> }>;
  consultar(orderId: string): Promise<SituacaoNaMaquininha>;
  /** tira o pedido da maquininha; a Stone exige fechar depois de pago (limite de 30 abertos) */
  fechar(orderId: string, status: 'paid' | 'canceled' | 'failed'): Promise<void>;
}

/**
 * Simulador: o caminho inteiro sem maquininha. O pedido fica "esperando o
 * cartão" até alguém apertar "simular pagamento" na tela — nunca se paga
 * sozinho, para ninguém confundir teste com dinheiro.
 */
export class SimuladorDeMaquininha implements Maquininha {
  readonly driver = 'simulador';
  readonly environment = 'SIMULATOR' as const;

  async criar(pedido: PedidoParaMaquininha) {
    return { orderId: `sim_${pedido.ref}`, raw: { simulacao: true } };
  }

  async consultar(): Promise<SituacaoNaMaquininha> {
    return {
      status: 'PENDING',
      paidAmountCents: null,
      paidAt: null,
      chargeId: null,
      cardBrand: null,
      authorizationCode: null,
      failureReason: null,
      raw: { simulacao: true },
    };
  }

  async fechar() {}
}

const TIPO: Record<PosMethod, string> = { CREDIT_CARD: 'credit', DEBIT_CARD: 'debit', PIX: 'pix' };

type Json = Record<string, unknown>;
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Connect Stone 2.0 (Pagar.me core v5). Autenticação: Basic com a Secret Key como usuário e senha vazia. */
export class StoneConnect implements Maquininha {
  readonly driver = 'stone';
  readonly environment = 'PRODUCTION' as const;

  constructor(
    private readonly opcoes: { secretKey: string; serviceRefererName: string; baseUrl?: string; fetch?: typeof fetch },
  ) {}

  private async chamar(metodo: 'GET' | 'POST' | 'PATCH', caminho: string, corpo?: Json): Promise<Json> {
    const f = this.opcoes.fetch ?? fetch;
    const resposta = await f(`${this.opcoes.baseUrl ?? 'https://api.pagar.me'}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.opcoes.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ServiceRefererName: this.opcoes.serviceRefererName,
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const bruto = await resposta.text();
    let json: Json;
    try {
      json = bruto ? (JSON.parse(bruto) as Json) : {};
    } catch {
      json = { corpo: bruto.slice(0, 500) };
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error('A Stone recusou a chave da oficina. Confira a Secret Key em Configurações → Maquininha.');
    }
    if (!resposta.ok) {
      const mensagem = texto(json.message) ?? `A Stone respondeu ${resposta.status}.`;
      const erros = json.errors && typeof json.errors === 'object' ? ` ${JSON.stringify(json.errors).slice(0, 300)}` : '';
      throw new Error(`${mensagem}${erros}`);
    }
    return json;
  }

  async criar(pedido: PedidoParaMaquininha) {
    const setup: Json = { type: TIPO[pedido.method] };
    if (pedido.method === 'CREDIT_CARD') {
      setup.installments = pedido.installments;
      // parcelado lojista: o cliente não paga juros; a oficina assume a taxa
      setup.installment_type = 'merchant';
    }
    const corpo: Json = {
      code: pedido.ref.replace(/-/g, '').slice(0, 52),
      customer: { name: pedido.customer.name.slice(0, 64), email: pedido.customer.email },
      items: [{ amount: pedido.amountCents, description: pedido.description.slice(0, 256), quantity: 1, code: 'oficinaos' }],
      closed: false,
      poi_payment_settings: {
        visible: true,
        display_name: pedido.displayName.slice(0, 40),
        print_order_receipt: false,
        devices_serial_number: [pedido.deviceSerial],
        payment_setup: setup,
      },
      metadata: { oficinaos_ref: pedido.ref },
    };
    const json = await this.chamar('POST', '/core/v5/orders', corpo);
    const orderId = texto(json.id);
    if (!orderId) throw new Error('A Stone não devolveu o número do pedido.');
    return { orderId, raw: json };
  }

  async consultar(orderId: string): Promise<SituacaoNaMaquininha> {
    const json = await this.chamar('GET', `/core/v5/orders/${encodeURIComponent(orderId)}`);
    return lerPedido(json);
  }

  async fechar(orderId: string, status: 'paid' | 'canceled' | 'failed') {
    await this.chamar('PATCH', `/core/v5/orders/${encodeURIComponent(orderId)}/closed`, { status });
  }
}

/**
 * O pedido da Pagar.me traduzido. Uma charge paga é o pagamento; a mesma
 * charge depois "canceled"/"refunded" é o estorno feito na maquininha.
 */
export function lerPedido(json: Json): SituacaoNaMaquininha {
  const charges = Array.isArray(json.charges) ? (json.charges as Json[]) : [];
  const paga = charges.find((c) => c.status === 'paid');
  const estornada = charges.find((c) => (c.status === 'canceled' || c.status === 'refunded') && c.paid_at);
  const recusada = charges.find((c) => c.status === 'failed');
  const charge = paga ?? estornada ?? recusada ?? null;
  const meta = (charge?.metadata ?? {}) as Json;
  const ultima = (charge?.last_transaction ?? {}) as Json;

  let status: PosChargeStatus = 'PENDING';
  if (paga) status = 'PAID';
  else if (estornada) status = 'REFUNDED';
  else if (json.status === 'canceled') status = 'CANCELED';
  else if (json.status === 'failed' || (recusada && json.closed === true)) status = 'FAILED';

  const pagoEm = texto(charge?.paid_at);
  return {
    status,
    paidAmountCents: typeof charge?.paid_amount === 'number' ? charge.paid_amount : typeof charge?.amount === 'number' ? charge.amount : null,
    paidAt: pagoEm ? new Date(pagoEm) : null,
    chargeId: texto(charge?.id),
    cardBrand: texto(meta.scheme_name),
    authorizationCode: texto(meta.authorization_code),
    failureReason: recusada && !paga ? (texto(ultima.acquirer_message) ?? 'Pagamento recusado na maquininha.') : null,
    raw: json,
  };
}
