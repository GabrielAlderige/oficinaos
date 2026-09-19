import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  devidoCents,
  formatPlate,
  saldoCents,
  whatsappLink,
  WORK_ORDER_STATUS_LABELS,
  type PublicTracking,
  type TrackingLinkResult,
  type TrackingStep,
  type WorkOrderStatus,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { workOrders } from '../../db/schema';
import { withTenant, withTrackingToken } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './work-orders.repository';

const novoToken = () => randomBytes(24).toString('base64url');

/** Os passos que o cliente entende. "Aguardando peça" some: para ele, é execução. */
const PASSOS: { key: string; label: string; status: WorkOrderStatus[] }[] = [
  { key: 'recebido', label: 'Carro recebido', status: ['OPEN', 'DIAGNOSING'] },
  { key: 'orcamento', label: 'Orçamento enviado', status: ['AWAITING_QUOTE', 'AWAITING_APPROVAL'] },
  { key: 'aprovado', label: 'Aprovado', status: ['APPROVED'] },
  { key: 'execucao', label: 'Em execução', status: ['IN_PROGRESS', 'WAITING_PARTS'] },
  { key: 'pronto', label: 'Pronto para retirada', status: ['COMPLETED'] },
  { key: 'entregue', label: 'Entregue', status: ['DELIVERED'] },
];

const ORDEM: WorkOrderStatus[] = [
  'OPEN',
  'DIAGNOSING',
  'AWAITING_QUOTE',
  'AWAITING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'WAITING_PARTS',
  'COMPLETED',
  'DELIVERED',
];

/**
 * "Acompanhe seu veículo" (E17). O cliente pergunta "e o meu carro?" por
 * WhatsApp o dia inteiro; esta página responde sozinha.
 *
 * O que ela mostra é só o que é dele: em que passo está, a previsão, o que
 * aprovou e quanto falta pagar. Custo de peça, margem e observação interna
 * não passam por aqui — a página é pública e o link pode ser encaminhado.
 */
export class TrackingService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Gera o link (uma vez) e devolve a mensagem pronta para o WhatsApp. */
  async link(auth: AuthContext, workOrderId: string, client: ClientInfo): Promise<TrackingLinkResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const found = await repo.findWorkOrder(tx, auth.organizationId, { id: workOrderId });
      if (!found) throw notFound('OS não encontrada.');

      const token =
        found.order.trackingToken ??
        (
          await tx
            .update(workOrders)
            .set({ trackingToken: novoToken() })
            .where(and(eq(workOrders.organizationId, auth.organizationId), eq(workOrders.id, workOrderId)))
            .returning({ token: workOrders.trackingToken })
        )[0]!.token!;

      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const publicUrl = `${this.deps.env.APP_URL}/acompanhar/${token}`;
      const message = [
        `Olá, ${found.customer.name.trim().split(/\s+/)[0]}! Aqui é da ${oficina?.name ?? 'oficina'}.`,
        `Você pode acompanhar o seu ${found.vehicle.make} ${found.vehicle.model} por este link, a qualquer hora:`,
        publicUrl,
      ].join('\n\n');
      const telefone = found.customer.whatsapp ?? found.customer.phone;

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'work_order.tracking_link',
        entityType: 'work_order',
        entityId: workOrderId,
        metadata: { number: found.order.number },
        ...client,
      });

      return { publicUrl, message, whatsappUrl: telefone ? whatsappLink(telefone, message) : null };
    });
  }

  /** A página do cliente. Sem sessão: o token é a credencial. */
  async publicGet(token: string): Promise<PublicTracking> {
    const alvo = await withTrackingToken(this.deps.db, token, async (tx) => {
      const [row] = await tx
        .select({ id: workOrders.id, organizationId: workOrders.organizationId })
        .from(workOrders)
        .where(eq(workOrders.trackingToken, token))
        .limit(1);
      return row;
    });
    if (!alvo) throw notFound('Acompanhamento não encontrado.');

    return withTenant(this.deps.db, { organizationId: alvo.organizationId }, async (tx) => {
      const found = await repo.findWorkOrder(tx, alvo.organizationId, { id: alvo.id });
      if (!found) throw notFound('Acompanhamento não encontrado.');
      const oficina = await orgRepo.findOrganization(tx, alvo.organizationId);
      const order = found.order;

      const indiceAtual = ORDEM.indexOf(order.status);
      const steps: TrackingStep[] = PASSOS.map((passo) => {
        const indiceDoPasso = Math.min(...passo.status.map((status) => ORDEM.indexOf(status)));
        const current = passo.status.includes(order.status);
        return {
          key: passo.key,
          label: passo.label,
          done: order.status === 'CANCELED' ? false : indiceDoPasso < indiceAtual,
          current,
          at: quandoDoPasso(passo.key, order),
        };
      });

      const aprovado = order.approvedTotalCents > 0 ? order.approvedTotalCents : null;
      return {
        shopName: oficina?.name ?? 'Oficina',
        shopWhatsapp: oficina?.whatsapp ?? null,
        number: order.number,
        status: order.status,
        statusLabel: WORK_ORDER_STATUS_LABELS[order.status],
        headline: manchete(order.status),
        vehicleLabel: `${found.vehicle.make} ${found.vehicle.model}${found.vehicle.plate ? ` · ${formatPlate(found.vehicle.plate)}` : ''}`,
        openedAt: order.openedAt.toISOString(),
        promisedAt: order.promisedAt?.toISOString() ?? null,
        steps,
        approvedTotalCents: aprovado,
        balanceCents: aprovado === null ? null : saldoCents({ ...order, approvedTotalCents: devidoCents(order) }),
      };
    });
  }
}

/** A frase do topo, escrita para o cliente — não é o rótulo do status. */
function manchete(status: WorkOrderStatus): string {
  switch (status) {
    case 'OPEN':
    case 'DIAGNOSING':
      return 'Recebemos seu carro e estamos avaliando o que ele precisa.';
    case 'AWAITING_QUOTE':
      return 'Estamos montando o orçamento.';
    case 'AWAITING_APPROVAL':
      return 'O orçamento está com você: é só aprovar para começarmos.';
    case 'APPROVED':
      return 'Orçamento aprovado. O serviço entra na fila.';
    case 'IN_PROGRESS':
      return 'Seu carro está na oficina, em serviço.';
    case 'WAITING_PARTS':
      return 'Estamos aguardando uma peça para continuar.';
    case 'COMPLETED':
      return 'Tudo pronto! Seu carro está esperando você.';
    case 'DELIVERED':
      return 'Serviço entregue. Qualquer coisa, é só chamar.';
    case 'CANCELED':
      return 'Este serviço foi cancelado.';
  }
}

function quandoDoPasso(key: string, order: repo.WorkOrderRow): string | null {
  const datas: Record<string, Date | null> = {
    recebido: order.openedAt,
    aprovado: order.approvedAt,
    execucao: order.startedAt,
    pronto: order.completedAt,
    entregue: order.deliveredAt,
  };
  return datas[key]?.toISOString() ?? null;
}
