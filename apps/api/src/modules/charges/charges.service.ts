import {
  cobrancaAberta,
  devidoCents,
  disponivelParaCobrar,
  ErrorCode,
  formatBRL,
  metodoDoCaixa,
  vencimentoPadrao,
  whatsappChargeMessage,
  whatsappLink,
  type CancelChargeInput,
  type Charge,
  type ChargeSummary,
  type CreateChargeInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { withChargeRef, withTenant } from '../../db/tenant';
import type { Tx } from '../../db/tenant';
import type { AvisoDeCobranca, PedidoDeCobranca } from '../../integrations/payments';
import * as customerRepo from '../customers/customers.repository';
import * as orgRepo from '../organizations/organizations.repository';
import { registrarPagamentoDaCobranca, recalcularPagamentoDaOs } from '../payments/payments.sync';
import * as paymentRepo from '../payments/payments.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as repo from './charges.repository';

/** Hoje no relógio da oficina, em 'YYYY-MM-DD'. */
const hojeNaOficina = (timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

/**
 * Cobrança online (V3, E19).
 *
 * Quatro coisas que explicam o resto do arquivo:
 *
 * 1. **Cobrança não é pagamento.** Ela vira pagamento quando o gateway avisa
 *    que caiu, e aí passa pelo MESMO caminho do dinheiro recebido na mão
 *    (`payments.sync`), para "recebido" ser um número só.
 * 2. **Não dá para cobrar duas vezes o mesmo saldo**: o que já está pendurado
 *    em cobrança aberta sai do teto da cobrança nova. Sem isso, dois Pix do
 *    valor inteiro terminam com o cliente pagando dois e a oficina devolvendo.
 * 3. **A chamada ao gateway roda FORA da transação** (mesma razão da nota
 *    fiscal): rede lenta não pode segurar o banco.
 * 4. **O aviso do gateway é a única fonte do "pago"** — e só entra com o
 *    token combinado, uma vez por evento.
 */
export class ChargesService {
  constructor(private readonly deps: ServiceDeps) {}

  // ------------------------------- leitura -------------------------------

  async summary(auth: AuthContext, workOrderId: string): Promise<ChargeSummary> {
    return withTenant(this.deps.db, auth, async (tx) => this.montarResumo(tx, auth.organizationId, workOrderId));
  }

  private async montarResumo(tx: Tx, organizationId: string, workOrderId: string): Promise<ChargeSummary> {
    const encontrada = await workOrderRepo.findWorkOrder(tx, organizationId, { id: workOrderId });
    if (!encontrada) throw notFound('OS não encontrada.');
    const { order, customer } = encontrada;

    const rows = await repo.listByWorkOrder(tx, organizationId, workOrderId);
    const pago = await paymentRepo.sumConfirmedCents(tx, organizationId, workOrderId);
    const saldoCents = Math.max(0, devidoCents(order) - pago);
    const pendingCents = await repo.pendingCents(tx, organizationId, workOrderId);

    const aberta = rows.find((row) => cobrancaAberta(row.charge.status));
    const oficina = await orgRepo.findOrganization(tx, organizationId);
    let whatsappUrl: string | null = null;
    let message: string | null = null;
    if (aberta?.charge.paymentUrl) {
      message = whatsappChargeMessage({
        customerName: customer.name,
        shopName: oficina?.name ?? 'Oficina',
        amount: formatBRL(aberta.charge.amountCents),
        url: aberta.charge.paymentUrl,
      });
      const telefone = customer.whatsapp ?? customer.phone;
      whatsappUrl = telefone ? whatsappLink(telefone, message) : null;
    }

    return {
      charges: rows.map((row) => this.toDto(row)),
      environment: this.deps.gateway.environment,
      provider: this.deps.gateway.driver,
      balanceCents: saldoCents,
      pendingCents,
      availableCents: disponivelParaCobrar({ saldoCents, emAbertoCents: pendingCents }),
      whatsappUrl,
      message,
    };
  }

  // ------------------------------- criação -------------------------------

  async create(
    auth: AuthContext,
    workOrderId: string,
    input: CreateChargeInput,
    client: ClientInfo,
  ): Promise<ChargeSummary> {
    const { chargeId, pedido } = await withTenant(this.deps.db, auth, async (tx) => {
      const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, workOrderId);
      if (!order) throw notFound('OS não encontrada.');

      const repetida = await repo.findByClientRequest(tx, auth.organizationId, input.clientRequestId);
      if (repetida) return { chargeId: repetida.id, pedido: null };

      if (order.status === 'CANCELED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'OS cancelada',
          'Não dá para cobrar de uma OS cancelada.',
        );
      }

      const pago = await paymentRepo.sumConfirmedCents(tx, auth.organizationId, workOrderId);
      const saldoCents = Math.max(0, devidoCents(order) - pago);
      const emAbertoCents = await repo.pendingCents(tx, auth.organizationId, workOrderId);
      const disponivel = disponivelParaCobrar({ saldoCents, emAbertoCents });
      if (input.amountCents > disponivel) {
        throw new AppError(
          422,
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          'Valor acima do que falta',
          disponivel === 0
            ? emAbertoCents > 0
              ? `Já existe cobrança aberta de ${formatBRL(emAbertoCents)} nesta OS. Cancele antes de cobrar de novo.`
              : 'Esta OS já está paga.'
            : `Dá para cobrar no máximo ${formatBRL(disponivel)}.`,
          [{ path: 'body.amountCents', message: `O máximo é ${formatBRL(disponivel)}` }],
        );
      }

      const cliente = await customerRepo.findCustomer(tx, auth.organizationId, order.customerId);
      if (!cliente) throw notFound('Cliente não encontrado.');
      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const hoje = hojeNaOficina(oficina?.timezone ?? 'America/Sao_Paulo');
      const dueDate = input.dueDate ?? vencimentoPadrao(hoje, input.method);
      if (dueDate < hoje) {
        throw new AppError(422, ErrorCode.BAD_REQUEST, 'Vencimento no passado', 'Escolha uma data de hoje em diante.');
      }
      const description = input.description?.trim() || `OS nº ${order.number} — ${oficina?.name ?? 'Oficina'}`;

      const cobranca = await repo.insertCharge(tx, {
        organizationId: auth.organizationId,
        workOrderId,
        customerId: order.customerId,
        method: input.method,
        status: 'PENDING',
        environment: this.deps.gateway.environment,
        provider: this.deps.gateway.driver,
        clientRequestId: input.clientRequestId,
        amountCents: input.amountCents,
        dueDate,
        description,
        createdBy: auth.userId,
      });

      const endereco = cliente.customer.address;
      const pedido: PedidoDeCobranca = {
        chargeId: cobranca.id,
        method: input.method,
        amountCents: input.amountCents,
        dueDate,
        description,
        cliente: {
          id: cliente.customer.id,
          name: cliente.customer.name,
          document: cliente.customer.document,
          email: cliente.customer.email,
          phone: cliente.customer.whatsapp ?? cliente.customer.phone,
          zip: endereco?.zip ?? null,
          street: endereco?.street ?? null,
          number: endereco?.number ?? null,
          district: endereco?.district ?? null,
          city: endereco?.city ?? null,
          state: endereco?.state ?? null,
          providerCustomerId: await repo.findProviderCustomerId(
            tx,
            auth.organizationId,
            order.customerId,
            this.deps.gateway.driver,
          ),
        },
      };
      return { chargeId: cobranca.id, pedido };
    });

    if (pedido) {
      try {
        const resposta = await this.deps.gateway.criar(pedido);
        await withTenant(this.deps.db, auth, async (tx) => {
          await repo.updateCharge(tx, chargeId, {
            status: resposta.status,
            providerChargeId: resposta.providerChargeId,
            providerCustomerId: resposta.providerCustomerId,
            paymentUrl: resposta.paymentUrl,
            pixPayload: resposta.pixPayload,
            pixQrImage: resposta.pixQrImage,
            boletoUrl: resposta.boletoUrl,
            barcode: resposta.barcode,
            providerResponse: resposta.raw,
          });
          await recordActivity(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'charge.created',
            entityType: 'charge',
            entityId: chargeId,
            workOrderId,
            metadata: { method: pedido.method, amountCents: pedido.amountCents },
            ...client,
          });
        });
      } catch (erro) {
        this.deps.log.error({ err: erro, chargeId }, 'gateway de pagamento falhou ao criar a cobrança');
        await withTenant(this.deps.db, auth, async (tx) => {
          await repo.updateCharge(tx, chargeId, {
            status: 'FAILED',
            failureReason: erro instanceof Error ? erro.message : 'O gateway não respondeu.',
          });
        });
      }
    }

    return withTenant(this.deps.db, auth, async (tx) => this.montarResumo(tx, auth.organizationId, workOrderId));
  }

  // ----------------------------- cancelamento -----------------------------

  async cancel(auth: AuthContext, chargeId: string, input: CancelChargeInput, client: ClientInfo): Promise<ChargeSummary> {
    const cobranca = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockCharge(tx, auth.organizationId, chargeId);
      if (!travada) throw notFound('Cobrança não encontrada.');
      if (travada.status === 'PAID') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Cobrança já paga',
          'O dinheiro já entrou: o caminho é estornar, não cancelar.',
        );
      }
      if (travada.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Cobrança já cancelada', 'Esta cobrança já estava cancelada.');
      }
      return travada;
    });

    if (cobranca.providerChargeId) {
      try {
        await this.deps.gateway.cancelar(cobranca.providerChargeId);
      } catch (erro) {
        // o gateway pode já ter cancelado sozinho (vencida, por exemplo); o
        // registro daqui não pode ficar preso por causa disso
        this.deps.log.warn({ err: erro, chargeId }, 'gateway recusou o cancelamento; seguindo com o registro local');
      }
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateCharge(tx, chargeId, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: input.reason.trim(),
        canceledBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'charge.canceled',
        entityType: 'charge',
        entityId: chargeId,
        workOrderId: cobranca.workOrderId,
        metadata: { reason: input.reason.trim() },
        ...client,
      });
    });

    return withTenant(this.deps.db, auth, async (tx) =>
      this.montarResumo(tx, auth.organizationId, cobranca.workOrderId),
    );
  }

  // -------------------------------- estorno -------------------------------

  async refund(auth: AuthContext, chargeId: string, client: ClientInfo): Promise<ChargeSummary> {
    const cobranca = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockCharge(tx, auth.organizationId, chargeId);
      if (!travada) throw notFound('Cobrança não encontrada.');
      if (travada.status !== 'PAID') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'Só cobrança paga se estorna',
          'Esta cobrança não recebeu dinheiro: cancele em vez de estornar.',
        );
      }
      return travada;
    });

    if (cobranca.providerChargeId) {
      await this.deps.gateway.estornar(cobranca.providerChargeId, cobranca.paidAmountCents ?? cobranca.amountCents);
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateCharge(tx, chargeId, { status: 'REFUNDED', refundedAt: new Date() });

      // o dinheiro saiu: o pagamento do caixa é cancelado, e o saldo da OS
      // volta sozinho (o mesmo caminho do estorno feito no balcão)
      if (cobranca.paymentId) {
        const pagamento = await paymentRepo.lockPayment(tx, auth.organizationId, cobranca.paymentId);
        if (pagamento && pagamento.status !== 'CANCELED') {
          await paymentRepo.updatePayment(tx, pagamento.id, {
            status: 'CANCELED',
            canceledAt: new Date(),
            canceledBy: auth.userId,
            cancelReason: 'Cobrança estornada no gateway',
          });
          const order = await workOrderRepo.lockWorkOrder(tx, auth.organizationId, cobranca.workOrderId);
          if (order) await recalcularPagamentoDaOs(tx, auth.organizationId, order);
        }
      }

      await workOrderRepo.insertEvent(tx, {
        organizationId: auth.organizationId,
        workOrderId: cobranca.workOrderId,
        type: 'PAYMENT',
        data: { estorno: true, amountCents: cobranca.paidAmountCents ?? cobranca.amountCents },
        actorUserId: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'charge.refunded',
        entityType: 'charge',
        entityId: chargeId,
        workOrderId: cobranca.workOrderId,
        ...client,
      });
    });

    return withTenant(this.deps.db, auth, async (tx) =>
      this.montarResumo(tx, auth.organizationId, cobranca.workOrderId),
    );
  }

  // ----------------------------- conciliação ------------------------------

  /**
   * O aviso do gateway. Sem login: quem prova a origem é o token do gateway
   * (o driver recusa aviso sem ele) e o id da cobrança, que diz de quem é o
   * dinheiro. Responde sempre 200 quando o aviso é legítimo mas não interessa
   * — gateway que recebe erro reenvia para sempre.
   */
  /**
   * Lê o aviso e prova a origem. Separado do tratamento porque o mesmo aviso
   * pode ser de uma cobrança do CLIENTE (aqui) ou da assinatura da OFICINA
   * (E20): quem decide o caminho é a rota, com o resultado desta leitura.
   */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: string) {
    return this.deps.gateway.lerAviso(headers, rawBody);
  }

  async handleChargeEvent(aviso: AvisoDeCobranca): Promise<{ handled: boolean; reason: string }> {
    // 1) de quem é este dinheiro? A capacidade lê UMA linha, sem oficina no contexto
    const cobranca = await withChargeRef(this.deps.db, aviso.providerChargeId, async (tx) =>
      repo.findByProviderRef(tx, aviso.providerChargeId),
    );
    if (!cobranca) {
      this.deps.log.warn({ providerChargeId: aviso.providerChargeId }, 'aviso de cobrança desconhecida');
      return { handled: false, reason: 'cobrança desconhecida' };
    }

    const auth = { organizationId: cobranca.organizationId, userId: cobranca.createdBy };
    return withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockCharge(tx, cobranca.organizationId, cobranca.id);
      if (!travada) return { handled: false, reason: 'cobrança sumiu' };

      // 2) o gateway reenvia o mesmo aviso até receber 200: processar duas
      // vezes daria baixa dobrada no mesmo dinheiro
      const novo = await repo.registrarAviso(tx, {
        provider: this.deps.gateway.driver,
        externalId: aviso.externalId,
        eventType: aviso.eventType,
        organizationId: cobranca.organizationId,
        chargeId: cobranca.id,
        payload: aviso.raw,
      });
      if (!novo) return { handled: false, reason: 'aviso repetido' };

      if (aviso.status !== 'PAID') {
        await repo.updateCharge(tx, travada.id, {
          status: aviso.status,
          failureReason: aviso.failureReason,
          providerResponse: aviso.raw,
        });
        return { handled: true, reason: `situação ${aviso.status}` };
      }
      if (travada.status === 'PAID') return { handled: false, reason: 'cobrança já estava paga' };

      const order = await workOrderRepo.lockWorkOrder(tx, cobranca.organizationId, travada.workOrderId);
      if (!order) return { handled: false, reason: 'OS sumiu' };

      const valor = aviso.paidAmountCents ?? travada.amountCents;
      const pagamento = await registrarPagamentoDaCobranca(tx, {
        organizationId: cobranca.organizationId,
        order,
        customerId: travada.customerId,
        method: metodoDoCaixa(travada.method),
        amountCents: valor,
        paidAt: aviso.paidAt ?? new Date(),
        // a cobrança é a chave: reenvio do aviso não cria segundo pagamento
        clientRequestId: travada.id,
        provider: this.deps.gateway.driver,
        providerPaymentId: aviso.providerChargeId,
        createdBy: travada.createdBy,
        notes: `Recebido pelo ${this.deps.gateway.driver} (cobrança online)`,
      });

      await repo.updateCharge(tx, travada.id, {
        status: 'PAID',
        paidAt: aviso.paidAt ?? new Date(),
        paidAmountCents: valor,
        paymentId: pagamento.id,
        providerResponse: aviso.raw,
      });

      await workOrderRepo.insertEvent(tx, {
        organizationId: cobranca.organizationId,
        workOrderId: travada.workOrderId,
        type: 'PAYMENT',
        data: { method: metodoDoCaixa(travada.method), amountCents: valor, online: true },
        actorUserId: null,
      });
      await recordActivity(tx, {
        organizationId: cobranca.organizationId,
        actorType: 'SYSTEM',
        actorUserId: null,
        action: 'charge.paid',
        entityType: 'charge',
        entityId: travada.id,
        workOrderId: travada.workOrderId,
        metadata: { amountCents: valor, provider: this.deps.gateway.driver },
      });
      return { handled: true, reason: 'pagamento registrado' };
    });
  }

  private toDto(row: repo.ChargeJoinedRow): Charge {
    const cobranca = row.charge;
    return {
      id: cobranca.id,
      method: cobranca.method,
      status: cobranca.status,
      environment: cobranca.environment,
      provider: cobranca.provider,
      workOrderId: cobranca.workOrderId,
      workOrderNumber: row.workOrderNumber,
      customerId: cobranca.customerId,
      customerName: row.customerName,
      amountCents: cobranca.amountCents,
      dueDate: cobranca.dueDate,
      description: cobranca.description,
      paymentUrl: cobranca.paymentUrl,
      pixPayload: cobranca.pixPayload,
      pixQrImage: cobranca.pixQrImage,
      boletoUrl: cobranca.boletoUrl,
      barcode: cobranca.barcode,
      paidAt: cobranca.paidAt?.toISOString() ?? null,
      paidAmountCents: cobranca.paidAmountCents,
      canceledAt: cobranca.canceledAt?.toISOString() ?? null,
      cancelReason: cobranca.cancelReason,
      refundedAt: cobranca.refundedAt?.toISOString() ?? null,
      failureReason: cobranca.failureReason,
      paymentId: cobranca.paymentId,
      createdAt: cobranca.createdAt.toISOString(),
    };
  }
}
