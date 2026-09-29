import { and, eq, isNull, sql } from 'drizzle-orm';
import { percentualDaComissao } from '@oficinaos/shared';
import { memberships, services, workOrderItems, workOrders } from '../db/schema';
import type { Tx } from '../db/tenant';
import { readOrganizationSettings } from './org-settings';

/**
 * Congela a comissão dos serviços quando a OS é finalizada (E26).
 *
 * O percentual é resolvido AQUI, uma vez, e gravado no item: serviço →
 * mecânico → oficina, o mais específico vence. Guardar o número em vez de
 * recalculá-lo depois é o que faz a comissão de fevereiro continuar sendo a
 * de fevereiro quando a oficina mudar a tabela em março.
 *
 * Só **serviço** entra: peça revendida não gera comissão, porque quem
 * comprou, guardou e assumiu o risco foi a oficina.
 *
 * Só itens **aprovados** entram: o que o cliente recusou não foi feito.
 *
 * Não sobrescreve o que já está congelado — reabrir e finalizar de novo não
 * pode mudar o combinado, e a reabertura não desfaz o trabalho que já estava
 * pago.
 */
export async function freezeCommissions(tx: Tx, organizationId: string, workOrderId: string): Promise<void> {
  const settings = await readOrganizationSettings(tx, organizationId);

  const [ordem] = await tx
    .select({ mechanicUserId: workOrders.mechanicUserId })
    .from(workOrders)
    .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, workOrderId)))
    .limit(1);

  const itens = await tx
    .select({
      id: workOrderItems.id,
      mechanicUserId: workOrderItems.mechanicUserId,
      serviceBps: services.commissionBps,
      serviceId: workOrderItems.serviceId,
    })
    .from(workOrderItems)
    .leftJoin(
      services,
      and(eq(services.organizationId, workOrderItems.organizationId), eq(services.id, workOrderItems.serviceId)),
    )
    .where(
      and(
        eq(workOrderItems.organizationId, organizationId),
        eq(workOrderItems.workOrderId, workOrderId),
        eq(workOrderItems.type, 'SERVICE'),
        eq(workOrderItems.approvalStatus, 'APPROVED'),
        isNull(workOrderItems.commissionBps),
      ),
    );
  if (!itens.length) return;

  // o percentual de cada mecânico, buscado uma vez só
  const mecanicos = [...new Set(itens.map((item) => item.mechanicUserId ?? ordem?.mechanicUserId).filter(Boolean))];
  const porMecanico = new Map<string, number | null>();
  for (const userId of mecanicos as string[]) {
    const [linha] = await tx
      .select({ commissionBps: memberships.commissionBps })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, userId)))
      .limit(1);
    porMecanico.set(userId, linha?.commissionBps ?? null);
  }

  for (const item of itens) {
    // sem serviço do catálogo não há percentual próprio; sem mecânico no item,
    // vale o responsável pela OS — que é quem a oficina vai pagar
    const mecanicoId = item.mechanicUserId ?? ordem?.mechanicUserId ?? null;
    if (!mecanicoId) continue;

    const bps = percentualDaComissao({
      servicoBps: item.serviceId ? item.serviceBps : null,
      mecanicoBps: porMecanico.get(mecanicoId) ?? null,
      oficinaBps: settings.commissionBps,
    });

    await tx
      .update(workOrderItems)
      .set({ commissionBps: bps, commissionUserId: mecanicoId })
      .where(and(eq(workOrderItems.organizationId, organizationId), eq(workOrderItems.id, item.id)));
  }
}

/** Quanto de comissão uma OS carrega, por mecânico, com o que já foi congelado. */
export async function commissionByOrder(tx: Tx, organizationId: string, workOrderIds: string[]) {
  if (!workOrderIds.length) return [];
  const { rows } = await tx.execute<{
    work_order_id: string;
    commission_user_id: string;
    commission_cents: string;
    labor_cents: string;
  }>(sql`
    select
      work_order_id,
      commission_user_id,
      sum(round(total_cents * commission_bps / 10000.0))::bigint as commission_cents,
      sum(total_cents)::bigint as labor_cents
    from work_order_items
    where organization_id = ${organizationId}
      and work_order_id in (${sql.join(
        workOrderIds.map((workOrderId) => sql`${workOrderId}::uuid`),
        sql`, `,
      )})
      and type = 'SERVICE'
      and commission_user_id is not null
      and coalesce(commission_bps, 0) > 0
    group by work_order_id, commission_user_id
  `);
  return rows.map((row) => ({
    workOrderId: row.work_order_id,
    mechanicUserId: row.commission_user_id,
    commissionCents: Number(row.commission_cents),
    laborCents: Number(row.labor_cents),
  }));
}
