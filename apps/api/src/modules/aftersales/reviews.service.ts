import {
  ErrorCode,
  whatsappLink,
  whatsappReviewInviteMessage,
  type ReviewInviteResult,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { readOrganizationSettings } from '../../core/org-settings';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';

/**
 * Avaliação do cliente (E16, refeita: agora a avaliação é **no Google**).
 *
 * A oficina cadastra o link do Perfil da Empresa e o convite leva o cliente
 * para lá. Não existe mais nota guardada aqui dentro, e é melhor assim: a
 * avaliação que traz cliente novo é a que aparece na busca, não um número que
 * só a oficina vê.
 *
 * A regra que não se negocia continua valendo: **o convite vai para todo
 * mundo**, não só para quem parece satisfeito. Filtrar por satisfação antes de
 * pedir estrela é contra as políticas do Google e, principalmente, é mentira.
 */
export class ReviewsService {
  constructor(private readonly deps: ServiceDeps) {}

  /**
   * O convite para avaliar no **Google**.
   *
   * A oficina cadastra o link do Perfil da Empresa em Configurações → Oficina,
   * e o convite leva esse link. A avaliação que muda a vida da oficina é a que
   * aparece para quem procura "oficina perto de mim" — uma nota guardada só
   * aqui dentro não aparece para ninguém.
   *
   * O convite vai para **todo mundo**, não só para quem parece satisfeito:
   * filtrar por satisfação antes de pedir estrela é contra as políticas do
   * Google e, principalmente, é mentira.
   */
  async invite(auth: AuthContext, workOrderId: string, client: ClientInfo): Promise<ReviewInviteResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const found = await workOrderRepo.findWorkOrder(tx, auth.organizationId, { id: workOrderId });
      if (!found) throw notFound('OS não encontrada.');
      if (found.order.status !== 'DELIVERED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'O carro ainda não foi entregue',
          'A avaliação é do serviço pronto: peça depois de entregar o veículo.',
        );
      }

      const settings = await readOrganizationSettings(tx, auth.organizationId);
      const googleUrl = settings.googleReviewUrl.trim();
      if (!googleUrl) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Falta o link do Google',
          'Cadastre o link de avaliação do Google da sua oficina em Configurações → Oficina. Sem ele, não há para onde mandar o cliente.',
        );
      }

      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const message = whatsappReviewInviteMessage({
        customerName: found.customer.name,
        shopName: oficina?.name ?? 'Oficina',
        url: googleUrl,
      });
      const telefone = found.customer.whatsapp ?? found.customer.phone;

      // fica no histórico de comunicação, como todo contato com o cliente
      await workOrderRepo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: found.customer.id,
        channel: 'WHATSAPP_LINK',
        direction: 'OUTBOUND',
        templateKey: 'REVIEW_INVITE',
        body: message,
        toAddress: telefone,
        workOrderId,
        status: 'LINK_OPENED',
        sentBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'review.invited',
        entityType: 'work_order',
        entityId: workOrderId,
        metadata: { number: found.order.number, destino: 'google' },
        ...client,
      });

      return {
        publicUrl: googleUrl,
        message,
        whatsappUrl: telefone ? whatsappLink(telefone, message) : null,
      };
    });
  }
}
