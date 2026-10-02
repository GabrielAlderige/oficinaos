import { and, between, desc, eq, sql } from 'drizzle-orm';
import {
  can,
  comissaoGanhaCents,
  devidoCents,
  ErrorCode,
  periodRange,
  type CommissionByMechanic,
  type CommissionOrder,
  type CommissionPayout,
  type CommissionQuery,
  type CommissionReport,
  type CreateCommissionPayoutInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { commissionByOrder } from '../../core/commissions';
import { AppError } from '../../core/errors';
import { readOrganizationSettings } from '../../core/org-settings';
import { commissionPayouts, customers, users, vehicles, workOrders } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';
import * as paymentRepo from '../payments/payments.repository';

/** Hoje no relógio da oficina, em 'YYYY-MM-DD'. */
const hojeNaOficina = (timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

const primeiroDiaDoMes = (dia: string) => `${dia.slice(0, 7)}-01`;

/**
 * Comissão do mecânico (E26).
 *
 * A comissão **não tem tabela própria**: ela é a conta entre três fatos que já
 * existem — o percentual congelado no item quando a OS foi finalizada, o
 * valor do serviço e o que o cliente pagou. Guardar o resultado ao lado desses
 * três seria uma quarta verdade, que diverge no dia em que um pagamento é
 * cancelado.
 *
 * O que vira registro é o **fechamento**: o dinheiro que a oficina pagou ao
 * mecânico. Esse não se recalcula.
 *
 * Quem administra vê a oficina inteira; o mecânico vê o dele. Não há tela para
 * "a comissão do colega".
 */
export class CommissionsService {
  constructor(private readonly deps: ServiceDeps) {}

  async report(auth: AuthContext, query: CommissionQuery): Promise<CommissionReport> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const settings = await readOrganizationSettings(tx, auth.organizationId);
      const timezone = await this.timezone(tx, auth.organizationId);
      const hoje = hojeNaOficina(timezone);
      const atalho =
        query.period && query.period !== 'custom' && !query.from && !query.to
          ? periodRange(query.period, timezone)
          : null;
      const from = atalho?.fromDay ?? query.from ?? primeiroDiaDoMes(hoje);
      const to = atalho?.toDay ?? query.to ?? hoje;

      // quem não administra só enxerga a própria comissão
      const veTudo = can(auth.role, 'commissions:manage');
      const filtroDeMecanico = veTudo ? query.mechanicId : auth.userId;

      const ordens = await this.ordensEntregues(tx, auth.organizationId, from, to);
      const comissoes = await commissionByOrder(
        tx,
        auth.organizationId,
        ordens.map((ordem) => ordem.id),
      );

      const nomes = await this.nomesDosMecanicos(tx, [...new Set(comissoes.map((linha) => linha.mechanicUserId))]);
      const porMecanico = new Map<string, CommissionByMechanic>();

      for (const linha of comissoes) {
        if (filtroDeMecanico && linha.mechanicUserId !== filtroDeMecanico) continue;
        const ordem = ordens.find((candidata) => candidata.id === linha.workOrderId);
        if (!ordem) continue;

        const entrada: CommissionOrder = {
          workOrderId: ordem.id,
          number: ordem.number,
          customerName: ordem.customerName,
          vehicleLabel: ordem.vehicleLabel,
          deliveredAt: ordem.deliveredAt?.toISOString() ?? null,
          dueCents: ordem.dueCents,
          paidCents: ordem.paidCents,
          fullCommissionCents: linha.commissionCents,
          earnedCents: comissaoGanhaCents(linha.commissionCents, ordem.paidCents, ordem.dueCents),
        };

        const atual = porMecanico.get(linha.mechanicUserId) ?? {
          mechanicUserId: linha.mechanicUserId,
          mechanicName: nomes.get(linha.mechanicUserId) ?? 'Sem nome',
          laborCents: 0,
          fullCommissionCents: 0,
          earnedCents: 0,
          paidOutCents: 0,
          orders: [],
        };
        atual.laborCents += linha.laborCents;
        atual.fullCommissionCents += entrada.fullCommissionCents;
        atual.earnedCents += entrada.earnedCents;
        atual.orders.push(entrada);
        porMecanico.set(linha.mechanicUserId, atual);
      }

      // o que já foi pago no período entra na mesma linha: a pergunta do dono
      // é "quanto ainda devo", não "quanto rendeu"
      for (const pago of await this.pagamentosNoPeriodo(tx, auth.organizationId, from, to)) {
        if (filtroDeMecanico && pago.mechanicUserId !== filtroDeMecanico) continue;
        const atual = porMecanico.get(pago.mechanicUserId);
        if (atual) atual.paidOutCents += pago.amountCents;
      }

      const mechanics = [...porMecanico.values()]
        .map((linha) => ({ ...linha, orders: linha.orders.sort((a, b) => b.number - a.number) }))
        .sort((a, b) => b.earnedCents - a.earnedCents);

      return {
        from,
        to,
        configured: settings.commissionBps > 0 || mechanics.length > 0,
        mechanics,
        totals: {
          fullCommissionCents: mechanics.reduce((soma, linha) => soma + linha.fullCommissionCents, 0),
          earnedCents: mechanics.reduce((soma, linha) => soma + linha.earnedCents, 0),
          paidOutCents: mechanics.reduce((soma, linha) => soma + linha.paidOutCents, 0),
        },
      };
    });
  }

  /**
   * Registra o pagamento da comissão. É um fato, não um cálculo: fica gravado
   * com o período a que se refere, para a conversa do mês seguinte ter onde
   * começar.
   */
  async pay(
    auth: AuthContext,
    input: CreateCommissionPayoutInput,
    client: ClientInfo,
  ): Promise<CommissionPayout> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const [mecanico] = await tx.select({ name: users.name }).from(users).where(eq(users.id, input.mechanicUserId));
      if (!mecanico) {
        throw new AppError(404, ErrorCode.NOT_FOUND, 'Mecânico não encontrado');
      }

      const [linha] = await tx
        .insert(commissionPayouts)
        .values({
          organizationId: auth.organizationId,
          mechanicUserId: input.mechanicUserId,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          amountCents: input.amountCents,
          notes: input.notes?.trim() || null,
          createdBy: auth.userId,
        })
        .returning();

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'commission.paid',
        entityType: 'commission_payout',
        entityId: linha!.id,
        metadata: { mechanicUserId: input.mechanicUserId, amountCents: input.amountCents },
        ...client,
      });

      return {
        id: linha!.id,
        mechanicUserId: linha!.mechanicUserId,
        mechanicName: mecanico.name,
        periodFrom: linha!.periodFrom,
        periodTo: linha!.periodTo,
        amountCents: linha!.amountCents,
        notes: linha!.notes,
        paidAt: linha!.paidAt.toISOString(),
        createdByName: null,
      };
    });
  }

  async listPayouts(auth: AuthContext): Promise<CommissionPayout[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const veTudo = can(auth.role, 'commissions:manage');
      const linhas = await tx
        .select({ payout: commissionPayouts, mechanicName: users.name })
        .from(commissionPayouts)
        .innerJoin(users, eq(users.id, commissionPayouts.mechanicUserId))
        .where(
          veTudo
            ? eq(commissionPayouts.organizationId, auth.organizationId)
            : and(
                eq(commissionPayouts.organizationId, auth.organizationId),
                eq(commissionPayouts.mechanicUserId, auth.userId),
              ),
        )
        .orderBy(desc(commissionPayouts.paidAt))
        .limit(60);

      return linhas.map((linha) => ({
        id: linha.payout.id,
        mechanicUserId: linha.payout.mechanicUserId,
        mechanicName: linha.mechanicName,
        periodFrom: linha.payout.periodFrom,
        periodTo: linha.payout.periodTo,
        amountCents: linha.payout.amountCents,
        notes: linha.payout.notes,
        paidAt: linha.payout.paidAt.toISOString(),
        createdByName: null,
      }));
    });
  }

  // ------------------------------ leituras --------------------------------

  /** As OS entregues no período, com o que devem e o que já pagaram. */
  private async ordensEntregues(tx: Tx, organizationId: string, from: string, to: string) {
    const linhas = await tx
      .select({
        order: workOrders,
        customerName: customers.name,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
      })
      .from(workOrders)
      .innerJoin(
        customers,
        and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)),
      )
      .innerJoin(
        vehicles,
        and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)),
      )
      .where(
        and(
          eq(workOrders.organizationId, organizationId),
          between(workOrders.completedAt, new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59.999`)),
        ),
      );

    const pagos = await Promise.all(
      linhas.map(async (linha) => paymentRepo.sumConfirmedCents(tx, organizationId, linha.order.id)),
    );

    return linhas.map((linha, indice) => ({
      id: linha.order.id,
      number: linha.order.number,
      customerName: linha.customerName,
      vehicleLabel: [linha.vehicleMake, linha.vehicleModel].filter(Boolean).join(' '),
      deliveredAt: linha.order.deliveredAt ?? linha.order.completedAt,
      dueCents: devidoCents(linha.order),
      paidCents: pagos[indice] ?? 0,
    }));
  }

  private async pagamentosNoPeriodo(tx: Tx, organizationId: string, from: string, to: string) {
    const linhas = await tx
      .select({ mechanicUserId: commissionPayouts.mechanicUserId, amountCents: commissionPayouts.amountCents })
      .from(commissionPayouts)
      .where(
        and(
          eq(commissionPayouts.organizationId, organizationId),
          sql`${commissionPayouts.periodFrom} >= ${from}::date`,
          sql`${commissionPayouts.periodTo} <= ${to}::date`,
        ),
      );
    return linhas;
  }

  private async nomesDosMecanicos(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const linhas = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`${users.id} in (${sql.join(ids.map((valor) => sql`${valor}::uuid`), sql`, `)})`);
    return new Map(linhas.map((linha) => [linha.id, linha.name]));
  }

  private async timezone(tx: Tx, organizationId: string): Promise<string> {
    const { rows } = await tx.execute<{ timezone: string }>(
      sql`select timezone from organizations where id = ${organizationId}`,
    );
    return rows[0]?.timezone ?? 'America/Sao_Paulo';
  }
}
