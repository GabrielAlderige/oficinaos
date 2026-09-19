import { createHash, randomBytes } from 'node:crypto';
import {
  ErrorCode,
  formatPlate,
  mediaDasNotas,
  whatsappLink,
  whatsappReviewInviteMessage,
  type PublicReview,
  type ReviewInviteResult,
  type ReviewSummary,
  type SubmitReviewInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { readOrganizationSettings } from '../../core/org-settings';
import { withReviewToken, withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as repo from './aftersales.repository';

const novoToken = () => randomBytes(32).toString('base64url');
const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

/**
 * Avaliação do cliente (E16).
 *
 * Duas regras de produto que não se negociam:
 * 1. **O convite vai para todo mundo**, não só para quem parece satisfeito.
 *    Filtrar por satisfação antes de pedir estrela é contra as políticas do
 *    Google e, principalmente, é mentira.
 * 2. A nota aparece como veio. Sem "aprovar" avaliação antes de publicar — o
 *    número que a oficina vê é o que os clientes deram.
 */
export class ReviewsService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Gera (ou reaproveita) o link da avaliação daquela OS e a mensagem pronta. */
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

      const existente = await repo.findReviewByWorkOrder(tx, auth.organizationId, workOrderId);
      // o token em texto não é guardado; reenviar gera um link novo, e o
      // anterior morre (mesma regra da cotação por link, E11)
      const token = novoToken();
      const review = existente
        ? await repo.updateReview(tx, existente.id, { tokenHash: sha256(token), invitedAt: new Date() })
        : await repo.insertReview(tx, {
            organizationId: auth.organizationId,
            workOrderId,
            customerId: found.customer.id,
            tokenHash: sha256(token),
            invitedAt: new Date(),
          });

      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const publicUrl = `${this.deps.env.APP_URL}/avaliacao/${token}`;
      const message = whatsappReviewInviteMessage({
        customerName: found.customer.name,
        shopName: oficina?.name ?? 'Oficina',
        url: publicUrl,
      });
      const telefone = found.customer.whatsapp ?? found.customer.phone;

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'review.invited',
        entityType: 'review',
        entityId: review.id,
        metadata: { number: found.order.number, reenviado: Boolean(existente) },
        ...client,
      });

      return {
        reviewId: review.id,
        publicUrl,
        message,
        whatsappUrl: telefone ? whatsappLink(telefone, message) : null,
      };
    });
  }

  /** A página pública, aberta só pelo token (sem sessão e sem oficina no contexto). */
  async publicGet(token: string): Promise<PublicReview> {
    const hash = sha256(token);
    const review = await withReviewToken(this.deps.db, hash, async (tx) => repo.findReviewByToken(tx, hash));
    if (!review) throw notFound('Avaliação não encontrada.');

    return withTenant(this.deps.db, { organizationId: review.organizationId }, async (tx) => {
      const found = await workOrderRepo.findWorkOrder(tx, review.organizationId, { id: review.workOrderId });
      const oficina = await orgRepo.findOrganization(tx, review.organizationId);
      const settings = await readOrganizationSettings(tx, review.organizationId);
      if (!review.firstViewedAt) await repo.updateReview(tx, review.id, { firstViewedAt: new Date() });

      return {
        shopName: oficina?.name ?? 'Oficina',
        submitted: review.submittedAt !== null,
        rating: review.rating,
        comment: review.comment,
        vehicleLabel: found
          ? `${found.vehicle.make} ${found.vehicle.model}${found.vehicle.plate ? ` · ${formatPlate(found.vehicle.plate)}` : ''}`
          : null,
        workOrderNumber: found?.order.number ?? 0,
        googleReviewUrl: settings.googleReviewUrl || null,
      };
    });
  }

  /** O cliente respondeu. Uma vez só: a nota dada é a nota que fica. */
  async submit(token: string, input: SubmitReviewInput, client: ClientInfo): Promise<PublicReview> {
    const hash = sha256(token);
    const review = await withReviewToken(this.deps.db, hash, async (tx) => repo.findReviewByToken(tx, hash));
    if (!review) throw notFound('Avaliação não encontrada.');
    if (review.submittedAt) {
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        'Avaliação já enviada',
        'Esta avaliação já foi respondida. Obrigado!',
      );
    }

    await withTenant(this.deps.db, { organizationId: review.organizationId }, async (tx) => {
      await repo.updateReview(tx, review.id, {
        rating: input.rating,
        comment: blankToNull(input.comment) ?? null,
        submittedAt: new Date(),
        ip: client.ip ?? null,
        userAgent: client.userAgent ?? null,
      });
      await recordActivity(tx, {
        organizationId: review.organizationId,
        actorUserId: null,
        action: 'review.submitted',
        entityType: 'review',
        entityId: review.id,
        metadata: { rating: input.rating },
        ...client,
      });
    });
    return this.publicGet(token);
  }

  /** O resumo para o painel: média, total, distribuição e as últimas. */
  async summary(auth: AuthContext): Promise<ReviewSummary> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { distribuicao, pendentes, ultimas } = await repo.reviewSummary(tx, auth.organizationId);
      const notas = distribuicao.flatMap((linha) => Array.from({ length: linha.total }, () => linha.rating));
      return {
        average: mediaDasNotas(notas),
        total: notas.length,
        distribution: [1, 2, 3, 4, 5].map((rating) => ({
          rating,
          count: distribuicao.find((linha) => linha.rating === rating)?.total ?? 0,
        })),
        pending: pendentes,
        latest: ultimas.map((linha) => ({
          id: linha.id,
          rating: linha.rating!,
          comment: linha.comment,
          customerName: linha.customerName,
          workOrderNumber: linha.workOrderNumber,
          submittedAt: linha.submittedAt!.toISOString(),
        })),
      };
    });
  }
}
