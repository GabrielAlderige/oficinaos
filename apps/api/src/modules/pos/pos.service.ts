import { and, desc, eq, ne } from 'drizzle-orm';
import {
  ErrorCode,
  formatBRL,
  POS_METHOD_LABELS,
  type PosCharge,
  type PosSettings,
  type StartPosChargeInput,
  type UpdatePosSettingsInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { cifrar, decifrar } from '../../core/secrets';
import { counterSales, customers, financialEntries, posCharges, posSettings, users, workOrders } from '../../db/schema';
import { withPosOrderRef, withTenant, type Tx } from '../../db/tenant';
import { SimuladorDeMaquininha, type Maquininha, type SituacaoNaMaquininha } from '../../integrations/payments/maquininha';
import type { FinanceService } from '../finance/finance.service';
import * as financeRepo from '../finance/finance.repository';
import * as paymentsRepo from '../payments/payments.repository';
import type { PaymentsService } from '../payments/payments.service';

type Linha = typeof posCharges.$inferSelect;
const SIMULADOR = new SimuladorDeMaquininha();
const DO_SISTEMA: ClientInfo = { ip: null, userAgent: 'maquininha' };

/**
 * Maquininha Stone (E50). Ver `packages/shared/src/pos.ts`.
 *
 * Três regras: (1) a chamada à Stone acontece FORA da transação; (2) quem
 * confirma o pagamento é a CONSULTA à Stone — o aviso (webhook) só diz "olhe
 * agora", então aviso forjado não lança dinheiro; (3) o lançamento no caixa
 * usa o id da cobrança como `clientRequestId`, e por isso aviso repetido,
 * tela consultando e aviso chegando juntos lançam UMA vez só.
 */
export class PosService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly payments: PaymentsService,
    private readonly finance: FinanceService,
  ) {}

  // ------------------------------------------------------------ configuração

  private parceiroPronto() {
    return Boolean(this.deps.env.STONE_SERVICE_REFERER_NAME?.trim());
  }

  private async lerConfig(tx: Tx, organizationId: string) {
    const [linha] = await tx.select().from(posSettings).where(eq(posSettings.organizationId, organizationId)).limit(1);
    return linha;
  }

  /** A maquininha de verdade quando a oficina tem chave E a plataforma é parceira Stone; o simulador quando não. */
  private maquininhaPara(config: Awaited<ReturnType<PosService['lerConfig']>>): Maquininha {
    if (config?.provider !== 'stone' || !config.secretKeyEnc || !this.parceiroPronto()) return SIMULADOR;
    return this.deps.maquininhaDaOficina({ secretKey: decifrar(config.secretKeyEnc, this.deps.env.SECRETS_KEY) });
  }

  private maquininhaDaCobranca(cobranca: Linha, config: Awaited<ReturnType<PosService['lerConfig']>>): Maquininha {
    // a cobrança fica com quem a criou: trocar a chave depois não manda o simulador consultar a Stone
    return cobranca.provider === 'simulador' ? SIMULADOR : this.maquininhaPara(config);
  }

  async settings(auth: AuthContext): Promise<PosSettings> {
    return withTenant(this.deps.db, auth, async (tx) => this.paraTelaConfig(await this.lerConfig(tx, auth.organizationId)));
  }

  private paraTelaConfig(config: Awaited<ReturnType<PosService['lerConfig']>>): PosSettings {
    return {
      provider: config?.provider === 'stone' && config.secretKeyEnc ? 'stone' : 'simulador',
      partnerReady: this.parceiroPronto(),
      keyHint: config?.secretKeyEnc ? (config.keyHint ?? null) : null,
      devices: config?.devices ?? [],
      updatedAt: config?.updatedAt?.toISOString() ?? null,
    };
  }

  async updateSettings(auth: AuthContext, input: UpdatePosSettingsInput, client: ClientInfo): Promise<PosSettings> {
    if (input.secretKey && !this.deps.env.SECRETS_KEY) {
      throw new AppError(503, ErrorCode.VALIDATION_FAILED, 'Servidor sem cofre', 'O servidor ainda não tem a SECRETS_KEY para guardar a chave com segurança.');
    }
    const seriais = input.devices?.map((d) => d.serial) ?? [];
    if (new Set(seriais).size !== seriais.length) {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Maquininha repetida', 'Cada número de série aparece uma vez só.');
    }
    return withTenant(this.deps.db, auth, async (tx) => {
      const antes = await this.lerConfig(tx, auth.organizationId);
      const chave = input.disconnect
        ? { provider: 'simulador', secretKeyEnc: null, keyHint: null }
        : input.secretKey
          ? { provider: 'stone', secretKeyEnc: cifrar(input.secretKey, this.deps.env.SECRETS_KEY), keyHint: input.secretKey.slice(-4) }
          : {};
      const valores = { ...chave, ...(input.devices ? { devices: input.devices } : {}), updatedBy: auth.userId, updatedAt: new Date() };
      if (antes) {
        await tx.update(posSettings).set(valores).where(eq(posSettings.organizationId, auth.organizationId));
      } else {
        await tx.insert(posSettings).values({ organizationId: auth.organizationId, ...valores });
      }
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: input.disconnect ? 'pos.disconnected' : input.secretKey ? 'pos.key_saved' : 'pos.devices_updated',
        entityType: 'pos_settings',
        entityId: auth.organizationId,
        // a chave NUNCA entra no registro de atividade
        metadata: { devices: input.devices?.length ?? null },
        ...client,
      });
      return this.paraTelaConfig(await this.lerConfig(tx, auth.organizationId));
    });
  }

  // ---------------------------------------------------------------- cobrança

  async start(auth: AuthContext, input: StartPosChargeInput & { workOrderId: string | null; counterSaleId: string | null; installments: number }, client: ClientInfo): Promise<PosCharge> {
    // o saldo da OS é o do caixa da OS (aprovado menos o já recebido), lido como sempre
    const saldoDaOs = input.workOrderId ? (await this.payments.list(auth, input.workOrderId)).balanceCents : null;
    const preparado = await withTenant(this.deps.db, auth, async (tx) => {
      const [repetida] = await tx
        .select()
        .from(posCharges)
        .where(and(eq(posCharges.organizationId, auth.organizationId), eq(posCharges.clientRequestId, input.clientRequestId)))
        .limit(1);
      if (repetida) return { cobranca: repetida, pedido: null, maquininha: SIMULADOR };

      const config = await this.lerConfig(tx, auth.organizationId);
      if (!config?.devices.some((d) => d.serial === input.deviceSerial)) {
        throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Maquininha não cadastrada', 'Cadastre a maquininha em Configurações → Maquininha.');
      }
      const maquininha = this.maquininhaPara(config);
      const falta = await this.faltaReceber(tx, auth.organizationId, input, saldoDaOs);
      if (input.amountCents > falta.cents) {
        throw new AppError(
          422,
          ErrorCode.PAYMENT_EXCEEDS_BALANCE,
          'Valor acima do saldo',
          falta.cents === 0 ? 'Não há nada a receber aqui.' : `Falta receber ${formatBRL(falta.cents)}.`,
        );
      }
      const aberta = await tx
        .select({ id: posCharges.id })
        .from(posCharges)
        .where(
          and(
            eq(posCharges.organizationId, auth.organizationId),
            eq(posCharges.deviceSerial, input.deviceSerial),
            eq(posCharges.status, 'PENDING'),
          ),
        )
        .limit(1);
      if (aberta.length) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Maquininha ocupada', 'Esta maquininha já está esperando outro pagamento. Conclua ou cancele aquele primeiro.');
      }

      const [cobranca] = await tx
        .insert(posCharges)
        .values({
          organizationId: auth.organizationId,
          workOrderId: input.workOrderId,
          counterSaleId: input.counterSaleId,
          method: input.method,
          installments: input.installments,
          amountCents: input.amountCents,
          deviceSerial: input.deviceSerial,
          environment: maquininha.environment,
          provider: maquininha.driver,
          clientRequestId: input.clientRequestId,
          createdBy: auth.userId,
        })
        .returning();
      const [operador] = await tx.select({ email: users.email }).from(users).where(eq(users.id, auth.userId)).limit(1);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'pos.charge_sent',
        entityType: 'pos_charge',
        entityId: cobranca!.id,
        workOrderId: input.workOrderId ?? undefined,
        metadata: { amountCents: input.amountCents, method: input.method, installments: input.installments, device: input.deviceSerial },
        ...client,
      });
      return {
        cobranca: cobranca!,
        maquininha,
        pedido: {
          ref: cobranca!.id,
          amountCents: input.amountCents,
          description: falta.descricao,
          method: input.method,
          installments: input.installments,
          deviceSerial: input.deviceSerial,
          displayName: falta.descricao,
          // a Pagar.me exige nome e e-mail no pedido; sem o do cliente, vai o de quem cobrou
          customer: { name: falta.cliente?.name ?? 'Cliente do balcão', email: falta.cliente?.email ?? operador?.email ?? 'sem-email@oficinaosbr.cloud' },
        },
      };
    });

    if (preparado.pedido) {
      try {
        const { orderId, raw } = await preparado.maquininha.criar(preparado.pedido);
        await withTenant(this.deps.db, auth, (tx) =>
          tx.update(posCharges).set({ providerOrderId: orderId, providerResponse: raw, updatedAt: new Date() }).where(eq(posCharges.id, preparado.cobranca.id)),
        );
      } catch (erro) {
        this.deps.log.error({ err: erro, chargeId: preparado.cobranca.id }, 'a maquininha não recebeu o pedido');
        await withTenant(this.deps.db, auth, (tx) =>
          tx
            .update(posCharges)
            .set({ status: 'FAILED', failureReason: erro instanceof Error ? erro.message : 'A Stone não respondeu.', updatedAt: new Date() })
            .where(eq(posCharges.id, preparado.cobranca.id)),
        );
      }
    }
    return this.get(auth, preparado.cobranca.id);
  }

  /** O que falta receber da OS ou da venda — a maquininha não cobra mais do que isso. */
  private async faltaReceber(
    tx: Tx,
    organizationId: string,
    origem: { workOrderId: string | null; counterSaleId: string | null },
    saldoDaOs: number | null,
  ) {
    if (origem.workOrderId) {
      const [os] = await tx
        .select({ number: workOrders.number, status: workOrders.status, customerId: workOrders.customerId })
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, origem.workOrderId)))
        .limit(1);
      if (!os) throw notFound('OS não encontrada.');
      if (os.status === 'CANCELED') throw new AppError(422, ErrorCode.INVALID_TRANSITION, 'OS cancelada', 'OS cancelada não se cobra.');
      const [cliente] = await tx.select({ name: customers.name, email: customers.email }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, os.customerId))).limit(1);
      return { cents: saldoDaOs ?? 0, descricao: `OS ${os.number}`, cliente: cliente ? { name: cliente.name, email: cliente.email } : null };
    }
    const [venda] = await tx
      .select({ number: counterSales.number, status: counterSales.status, customerId: counterSales.customerId })
      .from(counterSales)
      .where(and(eq(counterSales.organizationId, organizationId), eq(counterSales.id, origem.counterSaleId!)))
      .limit(1);
    if (!venda) throw notFound('Venda não encontrada.');
    if (venda.status === 'CANCELED') throw new AppError(422, ErrorCode.INVALID_TRANSITION, 'Venda cancelada', 'Venda cancelada não se cobra.');
    const conta = await this.contaDaVenda(tx, organizationId, origem.counterSaleId!);
    const cliente = venda.customerId
      ? (await tx.select({ name: customers.name, email: customers.email }).from(customers).where(and(eq(customers.organizationId, organizationId), eq(customers.id, venda.customerId))).limit(1))[0]
      : undefined;
    return {
      cents: conta ? Math.max(0, conta.amountCents - conta.paidCents) : 0,
      descricao: `Venda ${venda.number}`,
      cliente: cliente ? { name: cliente.name, email: cliente.email } : null,
    };
  }

  private async contaDaVenda(tx: Tx, organizationId: string, counterSaleId: string) {
    const [conta] = await tx
      .select()
      .from(financialEntries)
      .where(and(eq(financialEntries.organizationId, organizationId), eq(financialEntries.counterSaleId, counterSaleId), ne(financialEntries.status, 'CANCELED')))
      .limit(1);
    return conta;
  }

  /** A cobrança; a que está esperando pergunta à Stone antes de responder (o aviso pode ter se perdido). */
  async get(auth: AuthContext, id: string): Promise<PosCharge> {
    const { cobranca, config } = await withTenant(this.deps.db, auth, async (tx) => ({
      cobranca: await this.achar(tx, auth.organizationId, id),
      config: await this.lerConfig(tx, auth.organizationId),
    }));
    if (cobranca.status === 'PENDING' && cobranca.providerOrderId && cobranca.provider !== 'simulador') {
      try {
        await this.aplicar(cobranca, await this.maquininhaDaCobranca(cobranca, config).consultar(cobranca.providerOrderId));
      } catch (erro) {
        this.deps.log.warn({ err: erro, chargeId: id }, 'consulta à maquininha falhou; segue esperando');
      }
    }
    return withTenant(this.deps.db, auth, async (tx) => paraTela(await this.achar(tx, auth.organizationId, id)));
  }

  async listFor(auth: AuthContext, origem: { workOrderId?: string; counterSaleId?: string }): Promise<PosCharge[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await tx
        .select()
        .from(posCharges)
        .where(
          and(
            eq(posCharges.organizationId, auth.organizationId),
            origem.workOrderId ? eq(posCharges.workOrderId, origem.workOrderId) : eq(posCharges.counterSaleId, origem.counterSaleId!),
          ),
        )
        .orderBy(desc(posCharges.createdAt))
        .limit(20);
      return linhas.map(paraTela);
    });
  }

  /** Desistir antes do cartão: o pedido sai da tela da maquininha. Se já foi pago, vale o pagamento. */
  async cancel(auth: AuthContext, id: string, client: ClientInfo): Promise<PosCharge> {
    const { cobranca, config } = await withTenant(this.deps.db, auth, async (tx) => ({
      cobranca: await this.achar(tx, auth.organizationId, id),
      config: await this.lerConfig(tx, auth.organizationId),
    }));
    if (cobranca.status !== 'PENDING') {
      throw new AppError(422, ErrorCode.INVALID_TRANSITION, 'Cobrança encerrada', 'Esta cobrança não está mais esperando. Estorno de pagamento é feito na própria maquininha.');
    }
    const maquininha = this.maquininhaDaCobranca(cobranca, config);
    if (cobranca.providerOrderId && cobranca.provider !== 'simulador') {
      const agora = await maquininha.consultar(cobranca.providerOrderId);
      if (agora.status === 'PAID') {
        await this.aplicar(cobranca, agora);
        throw new AppError(409, ErrorCode.CONFLICT, 'Já foi pago', 'O cliente pagou antes do cancelamento: o pagamento foi lançado. Para devolver, estorne na maquininha.');
      }
      await maquininha.fechar(cobranca.providerOrderId, 'canceled');
    }
    return withTenant(this.deps.db, auth, async (tx) => {
      await tx
        .update(posCharges)
        .set({ status: 'CANCELED', canceledAt: new Date(), updatedAt: new Date() })
        .where(and(eq(posCharges.id, id), eq(posCharges.status, 'PENDING')));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'pos.charge_canceled',
        entityType: 'pos_charge',
        entityId: id,
        ...client,
      });
      return paraTela(await this.achar(tx, auth.organizationId, id));
    });
  }

  /** Só no simulador: o "cliente passou o cartão" para percorrer o fluxo sem maquininha. */
  async simulatePaid(auth: AuthContext, id: string): Promise<PosCharge> {
    const cobranca = await withTenant(this.deps.db, auth, (tx) => this.achar(tx, auth.organizationId, id));
    if (cobranca.provider !== 'simulador') {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Maquininha de verdade', 'Esta cobrança está numa maquininha de verdade: o pagamento é feito nela.');
    }
    await this.aplicar(cobranca, {
      status: 'PAID',
      paidAmountCents: cobranca.amountCents,
      paidAt: new Date(),
      chargeId: null,
      cardBrand: cobranca.method === 'PIX' ? null : 'Simulação',
      authorizationCode: null,
      failureReason: null,
      raw: { simulacao: true },
    });
    return this.get(auth, id);
  }

  /**
   * O aviso da Stone (charge.paid / charge.refunded). Ele só aponta o pedido;
   * a situação é perguntada à Stone com a chave da oficina dona dele.
   */
  async handleWebhook(orderId: string): Promise<{ handled: boolean; reason: string }> {
    const cobranca = await withPosOrderRef(this.deps.db, orderId, async (tx) => {
      const [linha] = await tx.select().from(posCharges).where(eq(posCharges.providerOrderId, orderId)).limit(1);
      return linha;
    });
    if (!cobranca) return { handled: false, reason: 'pedido desconhecido' };
    if (cobranca.provider === 'simulador') return { handled: false, reason: 'cobrança do simulador' };
    const auth = { organizationId: cobranca.organizationId, userId: cobranca.createdBy };
    const config = await withTenant(this.deps.db, auth, (tx) => this.lerConfig(tx, cobranca.organizationId));
    const situacao = await this.maquininhaDaCobranca(cobranca, config).consultar(orderId);
    return this.aplicar(cobranca, situacao);
  }

  // ---------------------------------------------------------------- o caixa

  /** Leva a situação da maquininha para o caixa. Repetir é seguro: o lançamento tem a cobrança como chave. */
  private async aplicar(cobranca: Linha, situacao: SituacaoNaMaquininha): Promise<{ handled: boolean; reason: string }> {
    const auth: AuthContext = { organizationId: cobranca.organizationId, userId: cobranca.createdBy } as AuthContext;
    const atual = await withTenant(this.deps.db, auth, (tx) => this.achar(tx, cobranca.organizationId, cobranca.id));
    const maquininha = atual.provider === 'simulador' ? SIMULADOR : null;

    if (situacao.status === 'PENDING') {
      if (situacao.failureReason && situacao.failureReason !== atual.failureReason) {
        await this.atualizar(auth, atual.id, { failureReason: situacao.failureReason, providerResponse: situacao.raw });
      }
      return { handled: false, reason: 'ainda esperando' };
    }

    if (situacao.status === 'PAID') {
      if (atual.status === 'PAID') return { handled: false, reason: 'já estava pago' };
      if (atual.status !== 'PENDING' && atual.status !== 'CANCELED') return { handled: false, reason: `cobrança ${atual.status}` };
      const valor = situacao.paidAmountCents ?? atual.amountCents;
      const ref = await this.lancar(auth, atual, valor, situacao.paidAt ?? new Date());
      await withTenant(this.deps.db, auth, async (tx) => {
        await tx
          .update(posCharges)
          .set({
            status: 'PAID',
            paidAt: situacao.paidAt ?? new Date(),
            paidAmountCents: valor,
            settlementRef: ref,
            providerChargeId: situacao.chargeId,
            cardBrand: situacao.cardBrand,
            authorizationCode: situacao.authorizationCode,
            failureReason: null,
            canceledAt: null,
            providerResponse: situacao.raw,
            updatedAt: new Date(),
          })
          .where(and(eq(posCharges.id, atual.id), ne(posCharges.status, 'PAID')));
        await recordActivity(tx, {
          organizationId: atual.organizationId,
          actorType: 'SYSTEM',
          actorUserId: null,
          action: 'pos.charge_paid',
          entityType: 'pos_charge',
          entityId: atual.id,
          workOrderId: atual.workOrderId ?? undefined,
          metadata: { amountCents: valor, method: atual.method, brand: situacao.cardBrand },
        });
      });
      // a Stone pede para fechar o pedido pago: pedido aberto acumula e trava a maquininha (limite de 30)
      if (atual.providerOrderId && !maquininha) {
        const config = await withTenant(this.deps.db, auth, (tx) => this.lerConfig(tx, atual.organizationId));
        await this.maquininhaDaCobranca(atual, config)
          .fechar(atual.providerOrderId, 'paid')
          .catch((erro) => this.deps.log.warn({ err: erro, chargeId: atual.id }, 'não deu para fechar o pedido pago na Stone'));
      }
      return { handled: true, reason: 'pagamento lançado' };
    }

    if (situacao.status === 'REFUNDED') {
      if (atual.status !== 'PAID' || !atual.settlementRef) return { handled: false, reason: 'nada a estornar' };
      const motivo = 'Estornado na maquininha Stone';
      try {
        if (atual.workOrderId) await this.payments.cancel(auth, atual.settlementRef, { reason: motivo }, DO_SISTEMA);
        else await this.finance.cancelSettlement(auth, atual.settlementRef, motivo, DO_SISTEMA);
      } catch (erro) {
        // já cancelado à mão: o estorno vale do mesmo jeito
        this.deps.log.warn({ err: erro, chargeId: atual.id }, 'o lançamento do estorno já estava cancelado');
      }
      await this.atualizar(auth, atual.id, { status: 'REFUNDED', providerResponse: situacao.raw });
      return { handled: true, reason: 'estorno lançado' };
    }

    // CANCELED / FAILED vindos da Stone
    if (atual.status !== 'PENDING') return { handled: false, reason: `cobrança ${atual.status}` };
    await this.atualizar(auth, atual.id, {
      status: situacao.status,
      failureReason: situacao.failureReason,
      canceledAt: situacao.status === 'CANCELED' ? new Date() : null,
      providerResponse: situacao.raw,
    });
    return { handled: true, reason: `situação ${situacao.status}` };
  }

  /** Lança no caixa e devolve o id do lançamento: pagamento da OS ou baixa da venda. */
  private async lancar(auth: AuthContext, cobranca: Linha, valor: number, pagoEm: Date): Promise<string> {
    const notas = `Maquininha Stone · ${POS_METHOD_LABELS[cobranca.method]}${cobranca.installments > 1 ? ` em ${cobranca.installments}x` : ''}`;
    const jaLancado = () =>
      withTenant(this.deps.db, auth, async (tx) =>
        cobranca.workOrderId
          ? (await paymentsRepo.findByClientRequest(tx, auth.organizationId, cobranca.id))?.id
          : (await financeRepo.findSettlementByRequest(tx, auth.organizationId, cobranca.id))?.id,
      );
    const antes = await jaLancado();
    if (antes) return antes;
    try {
      if (cobranca.workOrderId) {
        await this.payments.record(
          auth,
          cobranca.workOrderId,
          { method: cobranca.method, amountCents: valor, installments: cobranca.installments, paidAt: pagoEm.toISOString(), notes: notas, clientRequestId: cobranca.id },
          DO_SISTEMA,
        );
      } else {
        const conta = await withTenant(this.deps.db, auth, (tx) => this.contaDaVenda(tx, auth.organizationId, cobranca.counterSaleId!));
        if (!conta) throw notFound('A conta da venda não foi encontrada.');
        await this.finance.settle(
          auth,
          conta.id,
          { clientRequestId: cobranca.id, amountCents: valor, method: cobranca.method, paidAt: pagoEm.toISOString(), notes: notas },
          DO_SISTEMA,
        );
      }
    } catch (erro) {
      // a tela e o aviso chegaram juntos: o outro lançou primeiro
      const depois = await jaLancado();
      if (depois) return depois;
      throw erro;
    }
    const id = await jaLancado();
    if (!id) throw new Error('lançamento da maquininha não encontrado depois de gravado');
    return id;
  }

  private async atualizar(auth: AuthContext, id: string, valores: Partial<typeof posCharges.$inferInsert>) {
    await withTenant(this.deps.db, auth, (tx) => tx.update(posCharges).set({ ...valores, updatedAt: new Date() }).where(eq(posCharges.id, id)));
  }

  private async achar(tx: Tx, organizationId: string, id: string) {
    const [linha] = await tx
      .select()
      .from(posCharges)
      .where(and(eq(posCharges.organizationId, organizationId), eq(posCharges.id, id)))
      .limit(1);
    if (!linha) throw notFound('Cobrança não encontrada.');
    return linha;
  }
}

const paraTela = (l: Linha): PosCharge => ({
  id: l.id,
  status: l.status,
  environment: l.environment,
  workOrderId: l.workOrderId,
  counterSaleId: l.counterSaleId,
  amountCents: l.amountCents,
  method: l.method,
  installments: l.installments,
  deviceSerial: l.deviceSerial,
  paidAmountCents: l.paidAmountCents,
  paidAt: l.paidAt?.toISOString() ?? null,
  cardBrand: l.cardBrand,
  authorizationCode: l.authorizationCode,
  failureReason: l.failureReason,
  createdAt: l.createdAt.toISOString(),
});
