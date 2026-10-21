import { and, count, desc, eq, isNotNull, max, sql } from 'drizzle-orm';
import {
  FOUNDER_PRICE_CENTS,
  FOUNDER_PRICE_MONTHS,
  FOUNDER_SLOTS,
  FOUNDER_TRIAL_DAYS,
  situacaoDaAssinatura,
  type ExtendTrialInput,
  type MakeFounderInput,
  type MarkSetupDoneInput,
  type PlatformOrganization,
  type PlatformOverview,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { ErrorCode } from '@oficinaos/shared';
import { memberships, organizations, plans, subscriptions, workOrders } from '../../db/schema';
import { withPlatformAdmin, withTenant } from '../../db/tenant';
import { iniciarTeste } from '../billing/inicio-do-teste';

const DIA = 86_400_000;
/** em teste e sem abrir OS há tantos dias: entra na conta de "ligar hoje" */
const DIAS_PARA_PARADA = 5;

/**
 * A plataforma operando o SaaS (E41).
 *
 * Só existe para quem tem `is_platform_admin` na conta — que não é papel de
 * oficina: nem o dono da oficina chega aqui.
 *
 * O que motivou: estender o teste de uma oficina exigia abrir o Postgres de
 * produção e escrever SQL na mão. Para um piloto com preço de fundador, que
 * precisa de 60 ou 90 dias em vez de 14, isso significava mexer no banco vivo
 * sem nenhum registro de quem fez nem por quê.
 */
export class PlatformService {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * Todas as oficinas, com a situação calculada pela MESMA função que a tela
   * da oficina usa (`situacaoDaAssinatura`). Se um dia a regra de carência
   * mudar, as duas telas mudam juntas — a pior versão disto seria a plataforma
   * dizer "em dia" enquanto a oficina vê "bloqueada".
   */
  async overview(): Promise<PlatformOverview> {
    const linhas = await withPlatformAdmin(this.deps.db, async (tx) => {
      const pessoas = tx
        .select({
          organizationId: memberships.organizationId,
          total: count().as('total'),
        })
        .from(memberships)
        .where(eq(memberships.isActive, true))
        .groupBy(memberships.organizationId)
        .as('pessoas');

      const ordens = tx
        .select({
          organizationId: workOrders.organizationId,
          total: count().as('total_os'),
          ultima: max(workOrders.createdAt).as('ultima_os'),
        })
        .from(workOrders)
        .groupBy(workOrders.organizationId)
        .as('ordens');

      return tx
        .select({
          id: organizations.id,
          name: organizations.name,
          document: organizations.document,
          email: organizations.email,
          whatsapp: organizations.whatsapp,
          createdAt: organizations.createdAt,
          activeUsers: sql<number>`coalesce(${pessoas.total}, 0)::int`,
          plan: plans.code,
          planName: plans.name,
          status: subscriptions.status,
          trialEndsAt: subscriptions.trialEndsAt,
          trialStartedAt: subscriptions.trialStartedAt,
          setupDoneAt: subscriptions.setupDoneAt,
          founderPriceCents: subscriptions.founderPriceCents,
          founderPriceUntil: subscriptions.founderPriceUntil,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          pastDueSince: subscriptions.pastDueSince,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
          workOrders: sql<number>`coalesce(${ordens.total}, 0)::int`,
          lastWorkOrderAt: ordens.ultima,
        })
        .from(organizations)
        .innerJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .leftJoin(pessoas, eq(pessoas.organizationId, organizations.id))
        .leftJoin(ordens, eq(ordens.organizationId, organizations.id))
        .orderBy(desc(organizations.createdAt));
    });

    const agora = Date.now();
    const oficinas: PlatformOrganization[] = linhas.map((linha) => {
      // `max()` de subconsulta pode chegar como texto: normaliza para Date
      const ultima = linha.lastWorkOrderAt ? new Date(linha.lastWorkOrderAt) : null;
      const desde = ultima ?? linha.createdAt;
      const situacao = situacaoDaAssinatura({
        status: linha.status,
        trialEndsAt: linha.trialEndsAt,
        currentPeriodEnd: linha.currentPeriodEnd,
        pastDueSince: linha.pastDueSince,
      });
      return {
        id: linha.id,
        name: linha.name,
        document: linha.document,
        email: linha.email,
        whatsapp: linha.whatsapp,
        createdAt: linha.createdAt.toISOString(),
        activeUsers: Number(linha.activeUsers ?? 0),
        plan: linha.plan,
        planName: linha.planName,
        status: linha.status,
        trialEndsAt: linha.trialEndsAt?.toISOString() ?? null,
        trialStartedAt: linha.trialStartedAt?.toISOString() ?? null,
        setupDoneAt: linha.setupDoneAt?.toISOString() ?? null,
        founder: linha.founderPriceCents !== null,
        founderPriceUntil: linha.founderPriceUntil?.toISOString() ?? null,
        lastWorkOrderAt: ultima?.toISOString() ?? null,
        workOrders: Number(linha.workOrders ?? 0),
        diasParada: Math.max(0, Math.floor((agora - desde.getTime()) / DIA)),
        subscribed: linha.providerSubscriptionId !== null,
        emTeste: situacao.emTeste,
        emCarencia: situacao.emCarencia,
        bloqueada: situacao.bloqueada,
        diasRestantes: situacao.diasRestantes,
      };
    });

    return {
      organizations: oficinas,
      total: oficinas.length,
      emTeste: oficinas.filter((o) => o.emTeste).length,
      assinantes: oficinas.filter((o) => o.subscribed).length,
      bloqueadas: oficinas.filter((o) => o.bloqueada).length,
      fundadoras: oficinas.filter((o) => o.founder).length,
      vagasDeFundadora: Math.max(0, FOUNDER_SLOTS - oficinas.filter((o) => o.founder).length),
      paradas: oficinas.filter((o) => o.emTeste && o.diasParada >= DIAS_PARA_PARADA).length,
    };
  }

  /**
   * Estende o teste. Conta a partir de HOJE, não do fim anterior: o caso real
   * é "o teste venceu ontem e a oficina ainda está decidindo" — somar ao fim
   * já vencido daria menos dias do que quem estendeu quis dar, e ninguém
   * percebe até o cliente reclamar.
   */
  async extendTrial(
    auth: AuthContext,
    organizationId: string,
    input: ExtendTrialInput,
    client: ClientInfo,
  ): Promise<PlatformOrganization> {
    const novoFim = new Date(Date.now() + input.days * 86_400_000);

    const alterou = await withPlatformAdmin(this.deps.db, async (tx) => {
      const [assinatura] = await tx
        .select({ status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      if (!assinatura) throw notFound('Oficina não encontrada.');

      if (assinatura.status !== 'TRIALING') {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Esta oficina não está em teste',
          `A assinatura está como ${assinatura.status}. Estender o teste de quem já assinou daria um teste que ninguém está usando — e esconderia o problema real, que é a cobrança.`,
        );
      }

      const [linha] = await tx
        .update(subscriptions)
        .set({ trialEndsAt: novoFim })
        .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, 'TRIALING')))
        .returning({ id: subscriptions.organizationId });
      return linha;
    });
    if (!alterou) throw notFound('Oficina não encontrada.');

    // a trilha fica NA oficina: é lá que a mudança faz efeito, e é lá que o
    // dono tem direito de ver que alguém da plataforma mexeu na assinatura dele
    await this.registrar(
      auth,
      organizationId,
      'subscription.trial_extended',
      { days: input.days, reason: input.reason, trialEndsAt: novoFim.toISOString() },
      client,
    );
    return this.umaOficina(organizationId);
  }

  /**
   * A implantação grátis da oferta Oficina Pronta foi feita (D92). Começa o
   * teste de 30 dias agora, se o primeiro orçamento ainda não o começou.
   * Marcar de novo não muda a data da primeira vez.
   */
  async markSetupDone(
    auth: AuthContext,
    organizationId: string,
    input: MarkSetupDoneInput,
    client: ClientInfo,
  ): Promise<PlatformOrganization> {
    const agora = new Date();
    const comecou = await withPlatformAdmin(this.deps.db, async (tx) => {
      const [assinatura] = await tx
        .select({ setupDoneAt: subscriptions.setupDoneAt })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      if (!assinatura) throw notFound('Oficina não encontrada.');
      if (!assinatura.setupDoneAt) {
        await tx.update(subscriptions).set({ setupDoneAt: agora }).where(eq(subscriptions.organizationId, organizationId));
      }
      return iniciarTeste(tx, organizationId, agora);
    });

    await this.registrar(
      auth,
      organizationId,
      'subscription.setup_done',
      { note: input.note ?? null, trialStarted: comecou },
      client,
    );
    return this.umaOficina(organizationId);
  }

  /**
   * Torna a oficina fundadora (D92): 90 dias de teste a partir de hoje e o
   * Nitro mensal a R$ 279 por 12 meses depois do teste.
   *
   * Só para quem ainda não assinou: o preço entra na hora de assinar, e mudar
   * o valor de uma cobrança que já existe no gateway é outra conversa. As 10
   * vagas são contadas dentro de uma trava — dois cliques ao mesmo tempo não
   * fazem a 11ª fundadora.
   */
  async makeFounder(
    auth: AuthContext,
    organizationId: string,
    input: MakeFounderInput,
    client: ClientInfo,
  ): Promise<PlatformOrganization> {
    const agora = new Date();
    const fimDoTeste = new Date(agora.getTime() + FOUNDER_TRIAL_DAYS * DIA);
    const precoAte = new Date(fimDoTeste);
    precoAte.setMonth(precoAte.getMonth() + FOUNDER_PRICE_MONTHS);

    await withPlatformAdmin(this.deps.db, async (tx) => {
      // a fila das vagas: uma fundadora de cada vez
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('oficinaos:fundadoras'))`);
      const [assinatura] = await tx
        .select({
          status: subscriptions.status,
          founderPriceCents: subscriptions.founderPriceCents,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
        })
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, organizationId))
        .limit(1);
      if (!assinatura) throw notFound('Oficina não encontrada.');
      if (assinatura.founderPriceCents !== null) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Já é fundadora', 'Esta oficina já ocupa uma das vagas de fundadora.');
      }
      if (assinatura.status !== 'TRIALING' || assinatura.providerSubscriptionId) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Esta oficina já assinou',
          'O preço de fundadora entra na hora de assinar. Para quem já tem cobrança no gateway, ajuste o valor direto no Asaas.',
        );
      }
      const [ocupadas] = await tx
        .select({ total: count() })
        .from(subscriptions)
        .where(isNotNull(subscriptions.founderPriceCents));
      if ((ocupadas?.total ?? 0) >= FOUNDER_SLOTS) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Acabaram as vagas', `As ${FOUNDER_SLOTS} vagas de fundadora já estão ocupadas.`);
      }
      await tx
        .update(subscriptions)
        .set({
          trialEndsAt: fimDoTeste,
          trialStartedAt: agora,
          founderPriceCents: FOUNDER_PRICE_CENTS,
          founderPriceUntil: precoAte,
        })
        .where(and(eq(subscriptions.organizationId, organizationId), eq(subscriptions.status, 'TRIALING')));
    });

    await this.registrar(
      auth,
      organizationId,
      'subscription.founder',
      { reason: input.reason, trialEndsAt: fimDoTeste.toISOString(), priceCents: FOUNDER_PRICE_CENTS, priceUntil: precoAte.toISOString() },
      client,
    );
    return this.umaOficina(organizationId);
  }

  /**
   * A trilha fica NA oficina: é lá que a mudança faz efeito, e é lá que o dono
   * tem direito de ver que alguém da plataforma mexeu na assinatura dele.
   */
  private async registrar(
    auth: AuthContext,
    organizationId: string,
    action: string,
    metadata: Record<string, unknown>,
    client: ClientInfo,
  ) {
    await withTenant(this.deps.db, { organizationId }, (tx) =>
      recordActivity(tx, {
        organizationId,
        actorUserId: auth.userId,
        action,
        entityType: 'subscription',
        entityId: organizationId,
        metadata,
        ...client,
      }),
    );
    this.deps.caches.subscriptions.delete(organizationId);
  }

  private async umaOficina(organizationId: string): Promise<PlatformOrganization> {
    const visao = await this.overview();
    const oficina = visao.organizations.find((o) => o.id === organizationId);
    if (!oficina) throw notFound('Oficina não encontrada.');
    return oficina;
  }
}
