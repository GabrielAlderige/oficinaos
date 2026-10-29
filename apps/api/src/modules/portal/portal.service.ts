import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  devidoCents,
  formatPlate,
  whatsappLink,
  whatsappPortalMessage,
  WORK_ORDER_STATUS_LABELS,
  type PublicPortal,
  type ReviewInviteResult,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { customers, quotes, vehicles, workOrderItems, workOrders } from '../../db/schema';
import { withPortalToken, withTenant } from '../../db/tenant';
import { randomToken, sha256 } from '../auth/tokens';
import * as orgRepo from '../organizations/organizations.repository';
import { manchete } from '../work-orders/tracking.service';

const rotuloDoCarro = (carro: { make: string; model: string; plate: string | null }) =>
  `${carro.make} ${carro.model}${carro.plate ? ` · ${formatPlate(carro.plate)}` : ''}`;

/**
 * App do cliente (E50). Ver `packages/shared/src/portal.ts`.
 *
 * A página pública lê pelo token só o CLIENTE (policy `customer_by_portal_token`)
 * para descobrir a oficina; o resto sai com o contexto da oficina e sempre
 * filtrado pelo id daquele cliente.
 */
export class PortalService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Gera um link novo (o anterior para de abrir) e a mensagem pronta para o WhatsApp. */
  async link(auth: AuthContext, customerId: string, client: ClientInfo): Promise<ReviewInviteResult> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const [cliente] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.organizationId, auth.organizationId), eq(customers.id, customerId), isNull(customers.deletedAt)))
        .limit(1);
      if (!cliente) throw notFound('Cliente não encontrado.');

      const token = randomToken();
      await tx
        .update(customers)
        .set({ portalTokenHash: sha256(token), portalTokenIssuedAt: new Date() })
        .where(eq(customers.id, customerId));

      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const publicUrl = `${this.deps.env.APP_URL}/cliente/${token}`;
      const message = whatsappPortalMessage({ customerName: cliente.name, shopName: oficina?.name ?? 'Oficina', url: publicUrl });
      const telefone = cliente.whatsapp ?? cliente.phone;
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'customer.portal_link',
        entityType: 'customer',
        entityId: customerId,
        metadata: {},
        ...client,
      });
      return { publicUrl, message, whatsappUrl: telefone ? whatsappLink(telefone, message) : null };
    });
  }

  /** A página do cliente. Sem sessão: o token é a credencial. */
  async publicView(token: string): Promise<PublicPortal> {
    const hash = sha256(token);
    const alvo = await withPortalToken(this.deps.db, hash, async (tx) => {
      const [linha] = await tx
        .select({ id: customers.id, organizationId: customers.organizationId, name: customers.name, deletedAt: customers.deletedAt })
        .from(customers)
        .where(eq(customers.portalTokenHash, hash))
        .limit(1);
      return linha;
    });
    if (!alvo || alvo.deletedAt) throw notFound('Este link não abre mais. Peça um novo à oficina.');

    return withTenant(this.deps.db, { organizationId: alvo.organizationId }, async (tx) => {
      const org = alvo.organizationId;
      const oficina = await orgRepo.findOrganization(tx, org);
      const carros = await tx
        .select({ id: vehicles.id, make: vehicles.make, model: vehicles.model, plate: vehicles.plate })
        .from(vehicles)
        .where(and(eq(vehicles.organizationId, org), eq(vehicles.customerId, alvo.id), isNull(vehicles.deletedAt)));
      const doCarro = new Map(carros.map((carro) => [carro.id, rotuloDoCarro(carro)]));

      const ordens = await tx
        .select()
        .from(workOrders)
        .where(and(eq(workOrders.organizationId, org), eq(workOrders.customerId, alvo.id), notInArray(workOrders.status, ['CANCELED'])))
        .orderBy(desc(workOrders.openedAt))
        .limit(60);
      const ativas = ordens.filter((os) => os.status !== 'DELIVERED');
      const entregues = ordens.filter((os) => os.status === 'DELIVERED').slice(0, 20);

      // o que foi feito em cada OS entregue: só os serviços aprovados, que é o que o cliente reconhece
      const servicos = entregues.length
        ? await tx
            .select({ workOrderId: workOrderItems.workOrderId, description: workOrderItems.description })
            .from(workOrderItems)
            .where(
              and(
                eq(workOrderItems.organizationId, org),
                inArray(
                  workOrderItems.workOrderId,
                  entregues.map((os) => os.id),
                ),
                eq(workOrderItems.type, 'SERVICE'),
                eq(workOrderItems.approvalStatus, 'APPROVED'),
              ),
            )
        : [];

      // orçamento esperando resposta: enviado, ainda na validade, e não substituído
      const abertos = ativas.length
        ? await tx
            .select({
              number: quotes.number,
              workOrderId: quotes.workOrderId,
              totalCents: quotes.totalCents,
              validUntil: quotes.validUntil,
              publicToken: quotes.publicToken,
            })
            .from(quotes)
            .where(
              and(
                eq(quotes.organizationId, org),
                inArray(
                  quotes.workOrderId,
                  ativas.map((os) => os.id),
                ),
                eq(quotes.status, 'SENT'),
                isNull(quotes.supersededByQuoteId),
                sql`${quotes.validUntil} > now()`,
              ),
            )
        : [];
      const veiculoDa = new Map(ordens.map((os) => [os.id, os.vehicleId]));
      const endereco = oficina?.address
        ? [
            [oficina.address.street, oficina.address.number].filter(Boolean).join(', '),
            oficina.address.district,
            [oficina.address.city, oficina.address.state].filter(Boolean).join(' - '),
          ]
            .filter(Boolean)
            .join(' · ') || null
        : null;

      return {
        shopName: oficina?.name ?? 'Oficina',
        shopWhatsapp: oficina?.whatsapp ?? null,
        shopAddress: endereco,
        customerFirstName: alvo.name.trim().split(/\s+/)[0] ?? alvo.name,
        vehicles: carros.map((carro) => ({ id: carro.id, label: `${carro.make} ${carro.model}`, plate: carro.plate ? formatPlate(carro.plate) : null })),
        current: ativas.map((os) => ({
          number: os.number,
          status: os.status,
          statusLabel: WORK_ORDER_STATUS_LABELS[os.status],
          headline: manchete(os.status),
          vehicleLabel: doCarro.get(os.vehicleId) ?? 'Veículo',
          openedAt: os.openedAt.toISOString(),
          promisedAt: os.promisedAt?.toISOString() ?? null,
          trackingUrl: os.trackingToken ? `${this.deps.env.APP_URL}/acompanhar/${os.trackingToken}` : null,
        })),
        quotes: abertos.map((orcamento) => ({
          number: orcamento.number,
          vehicleLabel: doCarro.get(veiculoDa.get(orcamento.workOrderId) ?? '') ?? 'Veículo',
          totalCents: orcamento.totalCents,
          validUntil: orcamento.validUntil.toISOString(),
          url: `${this.deps.env.APP_URL}/orcamento/${orcamento.publicToken}`,
        })),
        history: entregues.map((os) => ({
          number: os.number,
          vehicleLabel: doCarro.get(os.vehicleId) ?? 'Veículo',
          date: (os.deliveredAt ?? os.completedAt ?? os.openedAt).toISOString(),
          totalCents: devidoCents(os),
          services: servicos.filter((s) => s.workOrderId === os.id).map((s) => s.description),
        })),
      };
    });
  }

  /**
   * O manifesto do "pôr na tela inicial": o endereço de abertura é o link
   * DESTE cliente, então ele é montado na hora, por token.
   */
  async manifest(token: string): Promise<Record<string, unknown>> {
    const vista = await this.publicView(token);
    return {
      name: vista.shopName,
      short_name: vista.shopName.slice(0, 12),
      description: `Seus carros na ${vista.shopName}`,
      start_url: `/cliente/${encodeURIComponent(token)}`,
      scope: `/cliente/${encodeURIComponent(token)}`,
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#F26B1D',
      lang: 'pt-BR',
      icons: [
        { src: '/icone-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icone-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icone-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  }
}
