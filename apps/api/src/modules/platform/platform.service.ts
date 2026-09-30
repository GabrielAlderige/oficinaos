import { and, count, desc, eq, sql } from 'drizzle-orm';
import {
  situacaoDaAssinatura,
  type ExtendTrialInput,
  type PlatformOrganization,
  type PlatformOverview,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { ErrorCode } from '@oficinaos/shared';
import { memberships, organizations, plans, subscriptions } from '../../db/schema';
import { withPlatformAdmin, withTenant } from '../../db/tenant';

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
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          pastDueSince: subscriptions.pastDueSince,
          providerSubscriptionId: subscriptions.providerSubscriptionId,
        })
        .from(organizations)
        .innerJoin(subscriptions, eq(subscriptions.organizationId, organizations.id))
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .leftJoin(pessoas, eq(pessoas.organizationId, organizations.id))
        .orderBy(desc(organizations.createdAt));
    });

    const oficinas: PlatformOrganization[] = linhas.map((linha) => {
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
    await withTenant(this.deps.db, { organizationId }, (tx) =>
      recordActivity(tx, {
        organizationId,
        actorUserId: auth.userId,
        action: 'subscription.trial_extended',
        entityType: 'subscription',
        entityId: organizationId,
        metadata: { days: input.days, reason: input.reason, trialEndsAt: novoFim.toISOString() },
        ...client,
      }),
    );
    this.deps.caches.subscriptions.delete(organizationId);

    const visao = await this.overview();
    const oficina = visao.organizations.find((o) => o.id === organizationId);
    if (!oficina) throw notFound('Oficina não encontrada.');
    return oficina;
  }
}
