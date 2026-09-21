import {
  ErrorCode,
  precoDoCiclo,
  proximoVencimento,
  situacaoDaAssinatura,
  type BillingCycle,
  type BillingOverview,
  type CancelSubscriptionInput,
  type ChangePlanInput,
  type PlanOption,
  type StartSubscriptionInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { withSubscriptionRef, withTenant } from '../../db/tenant';
import type { Tx } from '../../db/tenant';
import type { AvisoDeCobranca } from '../../integrations/payments';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './billing.repository';

const hojeNaOficina = (timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

const inicioDoMes = (): Date => {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1);
};

/**
 * Assinatura do SaaS (V3, E20).
 *
 * Três coisas que explicam o resto:
 *
 * 1. **"Bloqueada" é calculado, não gravado** (`situacaoDaAssinatura`): teste
 *    vencido, carência de 7 dias depois do atraso, ou cancelamento passado do
 *    período pago. Gravar exigiria um job noturno só para a tela ficar certa.
 * 2. **Bloqueio é só de escrita** — e nunca das rotas de pagar e sair. A
 *    oficina bloqueada continua vendo tudo: trancar dado de quem atrasou um
 *    boleto é sequestro de dado, não cobrança.
 * 3. **Quem confirma o pagamento é o gateway**, pelo mesmo webhook da
 *    cobrança do cliente (E19). A tela nunca marca "pago".
 */
export class BillingService {
  constructor(private readonly deps: ServiceDeps) {}

  // ------------------------------- leitura -------------------------------

  async overview(auth: AuthContext): Promise<BillingOverview> {
    return withTenant(this.deps.db, auth, async (tx) => this.montar(tx, auth.organizationId));
  }

  private async montar(tx: Tx, organizationId: string): Promise<BillingOverview> {
    const assinatura = await repo.findSubscription(tx, organizationId);
    if (!assinatura) throw notFound('Assinatura não encontrada.');
    const planoAtual = await repo.findPlanById(tx, assinatura.planId);
    const lista = await repo.listPlans(tx);
    const uso = await repo.usage(tx, organizationId, inicioDoMes());
    const pagamentos = await repo.listPayments(tx, organizationId);
    const situacao = situacaoDaAssinatura(assinatura);

    const planos: PlanOption[] = lista.map((plano) => ({
      code: plano.code,
      name: plano.name,
      priceMonthlyCents: plano.priceMonthlyCents,
      priceYearlyCents: plano.priceYearlyCents,
      limits: plano.limits,
      features: plano.features,
      current: plano.id === assinatura.planId,
    }));

    return {
      plan: planoAtual?.code ?? 'STARTER',
      planName: planoAtual?.name ?? 'Plano',
      status: assinatura.status,
      cycle: assinatura.billingCycle,
      priceCents: assinatura.priceCents ?? (planoAtual ? precoDoCiclo(planoAtual, assinatura.billingCycle) : null),
      trialEndsAt: assinatura.trialEndsAt?.toISOString() ?? null,
      currentPeriodEnd: assinatura.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: assinatura.cancelAtPeriodEnd,
      emTeste: situacao.emTeste,
      emCarencia: situacao.emCarencia,
      bloqueada: situacao.bloqueada,
      diasRestantes: situacao.diasRestantes,
      trabalhaAte: situacao.trabalhaAte,
      subscribed: assinatura.providerSubscriptionId !== null,
      provider: assinatura.provider ?? this.deps.gateway.driver,
      environment: this.deps.gateway.environment,
      checkoutUrl: assinatura.checkoutUrl,
      usage: {
        users: uso.users,
        maxUsers: planoAtual?.limits.maxUsers ?? null,
        workOrdersThisMonth: uso.workOrdersThisMonth,
        maxWorkOrdersPerMonth: planoAtual?.limits.maxWorkOrdersPerMonth ?? null,
      },
      plans: planos,
      payments: pagamentos.map((pagamento) => ({
        id: pagamento.id,
        amountCents: pagamento.amountCents,
        status: pagamento.status,
        paidAt: pagamento.paidAt?.toISOString() ?? null,
        dueDate: pagamento.dueDate,
        periodStart: pagamento.periodStart,
        periodEnd: pagamento.periodEnd,
        invoiceUrl: pagamento.invoiceUrl,
      })),
    };
  }

  // ------------------------------ assinar --------------------------------

  /**
   * Assina (ou troca de plano) no gateway. A chamada de rede roda FORA da
   * transação, como na nota e na cobrança: gateway lento não segura o banco.
   */
  async start(auth: AuthContext, input: StartSubscriptionInput, client: ClientInfo): Promise<BillingOverview> {
    const preparo = await withTenant(this.deps.db, auth, async (tx) => {
      const assinatura = await repo.lockSubscription(tx, auth.organizationId);
      if (!assinatura) throw notFound('Assinatura não encontrada.');
      if (assinatura.providerSubscriptionId) {
        // já assinou: trocar de plano é outra porta
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Assinatura já existe',
          'Esta oficina já tem assinatura. Para mudar de plano, use "Trocar de plano".',
        );
      }
      const plano = await this.planoEscolhido(tx, input.plan, input.cycle);
      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      if (!oficina) throw notFound('Oficina não encontrada.');
      const hoje = hojeNaOficina(oficina.timezone);
      // quem ainda está em teste só começa a pagar quando o teste acabar
      const emTeste = assinatura.status === 'TRIALING' && (assinatura.trialEndsAt?.getTime() ?? 0) > Date.now();
      const vencimento = emTeste
        ? new Intl.DateTimeFormat('en-CA', { timeZone: oficina.timezone }).format(assinatura.trialEndsAt!)
        : hoje;

      return { assinatura, plano, oficina, vencimento };
    });

    const resposta = await this.deps.gateway.criarAssinatura({
      organizationId: auth.organizationId,
      amountCents: preparo.plano.preco,
      cycle: input.cycle,
      description: `OficinaOS — plano ${preparo.plano.row.name}`,
      nextDueDate: preparo.vencimento,
      cliente: {
        name: preparo.oficina.legalName ?? preparo.oficina.name,
        document: preparo.oficina.document,
        email: preparo.oficina.email,
        phone: preparo.oficina.whatsapp ?? preparo.oficina.phone,
        providerCustomerId: preparo.assinatura.providerCustomerId,
      },
    });

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateSubscription(tx, auth.organizationId, {
        planId: preparo.plano.row.id,
        billingCycle: input.cycle,
        priceCents: preparo.plano.preco,
        provider: this.deps.gateway.driver,
        providerCustomerId: resposta.providerCustomerId,
        providerSubscriptionId: resposta.providerSubscriptionId,
        checkoutUrl: resposta.checkoutUrl,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'subscription.started',
        entityType: 'subscription',
        entityId: auth.organizationId,
        metadata: { plan: input.plan, cycle: input.cycle, amountCents: preparo.plano.preco },
        ...client,
      });
    });
    this.deps.caches.subscriptions.delete(auth.organizationId);

    return withTenant(this.deps.db, auth, async (tx) => this.montar(tx, auth.organizationId));
  }

  /** Trocar de plano: o limite novo vale já; o preço, da próxima cobrança. */
  async changePlan(auth: AuthContext, input: ChangePlanInput, client: ClientInfo): Promise<BillingOverview> {
    const preparo = await withTenant(this.deps.db, auth, async (tx) => {
      const assinatura = await repo.lockSubscription(tx, auth.organizationId);
      if (!assinatura) throw notFound('Assinatura não encontrada.');
      const plano = await this.planoEscolhido(tx, input.plan, input.cycle);
      if (plano.row.id === assinatura.planId && assinatura.billingCycle === input.cycle) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Já é este plano', 'A oficina já está neste plano e ciclo.');
      }
      return { assinatura, plano };
    });

    if (preparo.assinatura.providerSubscriptionId) {
      await this.deps.gateway.atualizarAssinatura(preparo.assinatura.providerSubscriptionId, {
        amountCents: preparo.plano.preco,
        cycle: input.cycle,
        description: `OficinaOS — plano ${preparo.plano.row.name}`,
      });
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateSubscription(tx, auth.organizationId, {
        planId: preparo.plano.row.id,
        billingCycle: input.cycle,
        priceCents: preparo.plano.preco,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'subscription.plan_changed',
        entityType: 'subscription',
        entityId: auth.organizationId,
        metadata: { plan: input.plan, cycle: input.cycle, amountCents: preparo.plano.preco },
        ...client,
      });
    });
    this.deps.caches.subscriptions.delete(auth.organizationId);

    return withTenant(this.deps.db, auth, async (tx) => this.montar(tx, auth.organizationId));
  }

  /**
   * Cancelar não desliga na hora: a oficina trabalha até o fim do período que
   * já pagou. Cancelamento que apaga o acesso no mesmo minuto é o que faz a
   * pessoa ligar irritada — e ela tem razão.
   */
  async cancel(auth: AuthContext, input: CancelSubscriptionInput, client: ClientInfo): Promise<BillingOverview> {
    const assinatura = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockSubscription(tx, auth.organizationId);
      if (!travada) throw notFound('Assinatura não encontrada.');
      if (travada.status === 'CANCELED') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Assinatura já cancelada', 'Esta assinatura já estava cancelada.');
      }
      return travada;
    });

    if (assinatura.providerSubscriptionId) {
      await this.deps.gateway.cancelarAssinatura(assinatura.providerSubscriptionId);
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateSubscription(tx, auth.organizationId, {
        status: 'CANCELED',
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
        cancelReason: input.reason?.trim() ?? null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'subscription.canceled',
        entityType: 'subscription',
        entityId: auth.organizationId,
        metadata: { reason: input.reason ?? null },
        ...client,
      });
    });
    this.deps.caches.subscriptions.delete(auth.organizationId);

    return withTenant(this.deps.db, auth, async (tx) => this.montar(tx, auth.organizationId));
  }

  /** Desistiu de cancelar, ainda dentro do período pago. */
  async resume(auth: AuthContext, client: ClientInfo): Promise<BillingOverview> {
    const assinatura = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockSubscription(tx, auth.organizationId);
      if (!travada) throw notFound('Assinatura não encontrada.');
      if (travada.status !== 'CANCELED') {
        throw new AppError(409, ErrorCode.CONFLICT, 'Não está cancelada', 'Esta assinatura não foi cancelada.');
      }
      return travada;
    });

    // o gateway já encerrou a recorrência: assinar de novo é criar outra
    const plano = await withTenant(this.deps.db, auth, async (tx) => repo.findPlanById(tx, assinatura.planId));
    const oficina = await withTenant(this.deps.db, auth, async (tx) =>
      orgRepo.findOrganization(tx, auth.organizationId),
    );
    if (!plano || !oficina) throw notFound('Plano não encontrado.');
    const preco = assinatura.priceCents ?? precoDoCiclo(plano, assinatura.billingCycle) ?? plano.priceMonthlyCents;

    const resposta = await this.deps.gateway.criarAssinatura({
      organizationId: auth.organizationId,
      amountCents: preco,
      cycle: assinatura.billingCycle,
      description: `OficinaOS — plano ${plano.name}`,
      nextDueDate: hojeNaOficina(oficina.timezone),
      cliente: {
        name: oficina.legalName ?? oficina.name,
        document: oficina.document,
        email: oficina.email,
        phone: oficina.whatsapp ?? oficina.phone,
        providerCustomerId: assinatura.providerCustomerId,
      },
    });

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.updateSubscription(tx, auth.organizationId, {
        status: assinatura.currentPeriodEnd && assinatura.currentPeriodEnd > new Date() ? 'ACTIVE' : 'PAST_DUE',
        pastDueSince: assinatura.currentPeriodEnd && assinatura.currentPeriodEnd > new Date() ? null : new Date(),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        cancelReason: null,
        providerSubscriptionId: resposta.providerSubscriptionId,
        checkoutUrl: resposta.checkoutUrl,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'subscription.resumed',
        entityType: 'subscription',
        entityId: auth.organizationId,
        ...client,
      });
    });
    this.deps.caches.subscriptions.delete(auth.organizationId);

    return withTenant(this.deps.db, auth, async (tx) => this.montar(tx, auth.organizationId));
  }

  // ----------------------------- conciliação ------------------------------

  /**
   * Aviso do gateway sobre a cobrança de uma ASSINATURA. Mesma porta do aviso
   * da cobrança do cliente (E19): a diferença é que aqui quem paga é a
   * oficina, e o que muda é o acesso dela.
   */
  async handleSubscriptionEvent(aviso: AvisoDeCobranca): Promise<{ handled: boolean; reason: string }> {
    const ref = aviso.providerSubscriptionId;
    if (!ref) return { handled: false, reason: 'aviso sem assinatura' };

    const assinatura = await withSubscriptionRef(this.deps.db, ref, async (tx) => repo.findByProviderRef(tx, ref));
    if (!assinatura) {
      this.deps.log.warn({ providerSubscriptionId: ref }, 'aviso de assinatura desconhecida');
      return { handled: false, reason: 'assinatura desconhecida' };
    }

    const auth = { organizationId: assinatura.organizationId };
    const resultado = await withTenant(this.deps.db, auth, async (tx) => {
      const travada = await repo.lockSubscription(tx, assinatura.organizationId);
      if (!travada) return { handled: false, reason: 'assinatura sumiu' };

      const hoje = new Date();
      const pago = aviso.status === 'PAID';
      // o UNIQUE (provider, providerPaymentId) é a trava contra o reenvio
      const registro = await repo.insertPayment(tx, {
        organizationId: assinatura.organizationId,
        provider: this.deps.gateway.driver,
        providerPaymentId: aviso.providerChargeId,
        amountCents: aviso.paidAmountCents ?? travada.priceCents ?? 0,
        status: aviso.status,
        dueDate: (aviso.paidAt ?? hoje).toISOString().slice(0, 10),
        paidAt: aviso.paidAt,
        periodStart: pago ? (aviso.paidAt ?? hoje).toISOString().slice(0, 10) : null,
        periodEnd: pago
          ? proximoVencimento((aviso.paidAt ?? hoje).toISOString().slice(0, 10), travada.billingCycle)
          : null,
        invoiceUrl: null,
      });
      if (!registro) return { handled: false, reason: 'aviso repetido' };

      if (pago) {
        const inicio = aviso.paidAt ?? hoje;
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + (travada.billingCycle === 'MONTHLY' ? 30 : 365));
        await repo.updateSubscription(tx, assinatura.organizationId, {
          status: 'ACTIVE',
          currentPeriodStart: inicio,
          currentPeriodEnd: fim,
          pastDueSince: null,
          trialEndsAt: null,
        });
        return { handled: true, reason: 'assinatura renovada' };
      }

      if (aviso.status === 'EXPIRED' || aviso.status === 'FAILED') {
        await repo.updateSubscription(tx, assinatura.organizationId, {
          status: 'PAST_DUE',
          pastDueSince: travada.pastDueSince ?? hoje,
        });
        return { handled: true, reason: 'assinatura em atraso' };
      }
      return { handled: true, reason: `situação ${aviso.status}` };
    });

    this.deps.caches.subscriptions.delete(assinatura.organizationId);
    return resultado;
  }

  // ------------------------------- interno --------------------------------

  private async planoEscolhido(tx: Tx, code: ChangePlanInput['plan'], cycle: BillingCycle) {
    const row = await repo.findPlanByCode(tx, code);
    if (!row) throw notFound('Plano não encontrado.');
    const preco = precoDoCiclo(row, cycle);
    if (preco === null) {
      throw new AppError(
        422,
        ErrorCode.BAD_REQUEST,
        'Ciclo indisponível',
        `O plano ${row.name} ainda não tem preço anual cadastrado.`,
      );
    }
    return { row, preco };
  }
}
