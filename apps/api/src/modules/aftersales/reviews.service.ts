import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  can,
  ErrorCode,
  npsGroup,
  npsScore,
  whatsappLink,
  whatsappReviewInviteMessage,
  whatsappSurveyMessage,
  type PublicSurvey,
  type ReviewInviteResult,
  type SatisfactionSummary,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { readOrganizationSettings } from '../../core/org-settings';
import { customers, reviews, vehicles, workOrders } from '../../db/schema';
import { withReviewToken, withTenant, type Tx } from '../../db/tenant';
import { randomToken, sha256 } from '../auth/tokens';
import * as orgRepo from '../organizations/organizations.repository';
import * as quotesRepo from '../quotes/quotes.repository';
import * as workOrderRepo from '../work-orders/work-orders.repository';
import * as aftersalesRepo from './aftersales.repository';

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

  // ------------------------- pesquisa de satisfação (E49) -------------------------

  /**
   * O link da pesquisa de satisfação para o cliente que buscou o carro. Uma
   * pesquisa por OS; mandar de novo gera um link novo (o antigo deixa de
   * abrir), porque o token em texto não é guardado — só o hash.
   */
  async surveyInvite(auth: AuthContext, workOrderId: string, client: ClientInfo): Promise<ReviewInviteResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const found = await workOrderRepo.findWorkOrder(tx, auth.organizationId, { id: workOrderId });
      if (!found) throw notFound('OS não encontrada.');
      if (found.order.status !== 'DELIVERED') {
        throw new AppError(
          422,
          ErrorCode.INVALID_TRANSITION,
          'O carro ainda não foi entregue',
          'A pesquisa é sobre o serviço pronto: mande depois de entregar o veículo.',
        );
      }
      const existente = await aftersalesRepo.findReviewByWorkOrder(tx, auth.organizationId, workOrderId);
      if (existente?.submittedAt) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'O cliente já respondeu',
          `A nota desta OS já chegou: ${existente.rating}. Ela está no Pós-venda, em Satisfação.`,
        );
      }

      const token = randomToken();
      const agora = new Date();
      if (existente) {
        await aftersalesRepo.updateReview(tx, existente.id, { tokenHash: sha256(token), invitedAt: agora, updatedAt: agora });
      } else {
        await aftersalesRepo.insertReview(tx, {
          organizationId: auth.organizationId,
          workOrderId,
          customerId: found.customer.id,
          tokenHash: sha256(token),
          invitedAt: agora,
        });
      }

      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const publicUrl = `${this.deps.env.APP_URL}/pesquisa/${token}`;
      const message = whatsappSurveyMessage({
        customerName: found.customer.name,
        shopName: oficina?.name ?? 'Oficina',
        url: publicUrl,
      });
      const telefone = found.customer.whatsapp ?? found.customer.phone;
      await workOrderRepo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: found.customer.id,
        channel: 'WHATSAPP_LINK',
        direction: 'OUTBOUND',
        templateKey: 'SATISFACTION_SURVEY',
        body: message,
        toAddress: telefone,
        workOrderId,
        status: 'LINK_OPENED',
        sentBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'survey.invited',
        entityType: 'work_order',
        entityId: workOrderId,
        metadata: { number: found.order.number },
        ...client,
      });
      return { publicUrl, message, whatsappUrl: telefone ? whatsappLink(telefone, message) : null };
    });
  }

  /** A página do cliente: o token é a credencial, como no orçamento. */
  async publicSurvey(token: string): Promise<PublicSurvey> {
    const { review, organizationId } = await this.acharPorToken(token);
    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      if (!review.firstViewedAt) {
        await aftersalesRepo.updateReview(tx, review.id, { firstViewedAt: new Date() });
      }
      return this.visao(tx, organizationId, review.id);
    });
  }

  /**
   * A resposta: uma por pesquisa. Nota de 0 a 6 avisa quem cuida do cliente
   * na oficina — é a hora de ligar, antes que ele vá embora de vez.
   */
  async answerSurvey(token: string, input: { score: number; comment: string }, client: ClientInfo): Promise<PublicSurvey> {
    const { review, organizationId } = await this.acharPorToken(token);
    return withTenant(this.deps.db, { organizationId }, async (tx) => {
      const [atual] = await tx.select().from(reviews).where(eq(reviews.id, review.id)).limit(1).for('update');
      if (atual?.submittedAt) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Já respondida', 'Esta pesquisa já foi respondida. Obrigado!');
      }
      const agora = new Date();
      await aftersalesRepo.updateReview(tx, review.id, {
        rating: input.score,
        comment: input.comment.trim() || null,
        submittedAt: agora,
        firstViewedAt: atual?.firstViewedAt ?? agora,
        ip: client.ip,
        userAgent: client.userAgent,
        updatedAt: agora,
      });

      if (npsGroup(input.score) === 'DETRACTOR') {
        const [os] = await tx
          .select({ number: workOrders.number, customerName: customers.name })
          .from(workOrders)
          .innerJoin(customers, and(eq(customers.organizationId, workOrders.organizationId), eq(customers.id, workOrders.customerId)))
          .where(and(eq(workOrders.organizationId, organizationId), eq(workOrders.id, review.workOrderId)))
          .limit(1);
        const equipe = await quotesRepo.quoteWatchers(tx, organizationId);
        await quotesRepo.insertNotifications(
          tx,
          equipe
            .filter((member) => can(member.role, 'customers:view_contact'))
            .map((member) => ({
              organizationId,
              userId: member.userId,
              type: 'SATISFACTION_LOW' as const,
              title: `Nota ${input.score} na OS ${os?.number ?? ''}`.trim(),
              body: `${os?.customerName ?? 'O cliente'}${input.comment.trim() ? `: “${input.comment.trim().slice(0, 140)}”` : ' não deixou comentário.'}`,
              link: '/pos-venda?aba=satisfacao',
              workOrderId: review.workOrderId,
            })),
        );
      }
      return this.visao(tx, organizationId, review.id);
    });
  }

  /** O NPS da oficina e as últimas respostas, para o Pós-venda. */
  async satisfaction(auth: AuthContext): Promise<SatisfactionSummary> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const respondidas = await tx
        .select({ rating: reviews.rating })
        .from(reviews)
        .where(and(eq(reviews.organizationId, auth.organizationId), isNotNull(reviews.submittedAt)));
      const notas = respondidas.map((linha) => linha.rating ?? 0);
      const [pendentes] = await tx
        .select({ total: count() })
        .from(reviews)
        .where(
          and(eq(reviews.organizationId, auth.organizationId), isNull(reviews.submittedAt), isNotNull(reviews.invitedAt)),
        );
      const recentes = await tx
        .select({
          id: reviews.id,
          score: reviews.rating,
          comment: reviews.comment,
          submittedAt: reviews.submittedAt,
          customerName: customers.name,
          workOrderNumber: workOrders.number,
        })
        .from(reviews)
        .innerJoin(customers, and(eq(customers.organizationId, reviews.organizationId), eq(customers.id, reviews.customerId)))
        .innerJoin(workOrders, and(eq(workOrders.organizationId, reviews.organizationId), eq(workOrders.id, reviews.workOrderId)))
        .where(and(eq(reviews.organizationId, auth.organizationId), isNotNull(reviews.submittedAt)))
        .orderBy(desc(reviews.submittedAt))
        .limit(30);
      return {
        nps: npsScore(notas),
        answered: notas.length,
        promoters: notas.filter((n) => npsGroup(n) === 'PROMOTER').length,
        passives: notas.filter((n) => npsGroup(n) === 'PASSIVE').length,
        detractors: notas.filter((n) => npsGroup(n) === 'DETRACTOR').length,
        pending: Number(pendentes?.total ?? 0),
        recent: recentes.map((linha) => ({
          id: linha.id,
          score: linha.score ?? 0,
          comment: linha.comment,
          customerName: linha.customerName,
          workOrderNumber: linha.workOrderNumber,
          submittedAt: linha.submittedAt!.toISOString(),
        })),
      };
    });
  }

  private async acharPorToken(token: string) {
    const hash = sha256(token);
    const review = await withReviewToken(this.deps.db, hash, (tx) => aftersalesRepo.findReviewByToken(tx, hash));
    if (!review) throw notFound('Pesquisa não encontrada. O link pode ter sido trocado por um mais novo.');
    return { review, organizationId: review.organizationId };
  }

  private async visao(tx: Tx, organizationId: string, reviewId: string): Promise<PublicSurvey> {
    const [linha] = await tx
      .select({
        review: reviews,
        customerName: customers.name,
        workOrderNumber: workOrders.number,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(reviews)
      .innerJoin(customers, and(eq(customers.organizationId, reviews.organizationId), eq(customers.id, reviews.customerId)))
      .innerJoin(workOrders, and(eq(workOrders.organizationId, reviews.organizationId), eq(workOrders.id, reviews.workOrderId)))
      .innerJoin(vehicles, and(eq(vehicles.organizationId, workOrders.organizationId), eq(vehicles.id, workOrders.vehicleId)))
      .where(and(eq(reviews.organizationId, organizationId), eq(reviews.id, reviewId)))
      .limit(1);
    if (!linha) throw notFound('Pesquisa não encontrada.');
    const oficina = await orgRepo.findOrganization(tx, organizationId);
    const respondida = linha.review.submittedAt !== null;
    const google = respondida ? (await readOrganizationSettings(tx, organizationId)).googleReviewUrl.trim() : '';
    return {
      shopName: oficina?.name ?? 'Oficina',
      customerFirstName: linha.customerName.trim().split(/\s+/)[0] ?? linha.customerName,
      vehicle: `${linha.make} ${linha.model}`.trim(),
      workOrderNumber: linha.workOrderNumber,
      answered: respondida,
      score: linha.review.rating,
      // para QUALQUER nota: o convite do Google não depende de satisfação
      googleReviewUrl: google || null,
    };
  }
}
