import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  effectiveServicePrice,
  ErrorCode,
  milliToNumber,
  type CreatePackageInput,
  type PackageItem,
  type ServicePackage,
  type UpdatePackageInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, validationFailed } from '../../core/errors';
import { readOrganizationSettings } from '../../core/org-settings';
import { parts, servicePackageItems, servicePackages, services } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';

/**
 * Pacotes de serviço (E27).
 *
 * "Revisão dos 10.000 km" é seis linhas que a oficina digita toda semana. O
 * pacote guarda **o que entra e quanto**; o preço sai do catálogo no dia em
 * que ele é usado, e cada linha continua editável depois de cair na OS.
 *
 * Guardar preço aqui criaria uma segunda tabela de preços para manter — e um
 * pacote esquecido cobrando o valor do ano passado.
 */
export class PackagesService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, incluirInativos = false): Promise<ServicePackage[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await tx
        .select()
        .from(servicePackages)
        .where(and(eq(servicePackages.organizationId, auth.organizationId), isNull(servicePackages.deletedAt)))
        .orderBy(asc(servicePackages.name));

      const visiveis = incluirInativos ? linhas : linhas.filter((linha) => linha.isActive);
      return Promise.all(visiveis.map((linha) => this.montar(tx, auth.organizationId, linha)));
    });
  }

  async get(auth: AuthContext, id: string): Promise<ServicePackage> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const pacote = await this.buscar(tx, auth.organizationId, id);
      return this.montar(tx, auth.organizationId, pacote);
    });
  }

  async create(auth: AuthContext, input: CreatePackageInput, client: ClientInfo): Promise<ServicePackage> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const [pacote] = await tx
        .insert(servicePackages)
        .values({
          organizationId: auth.organizationId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          isActive: input.isActive,
          createdBy: auth.userId,
        })
        .returning();

      await this.gravarItens(tx, auth.organizationId, pacote!.id, input.items);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'package.created',
        entityType: 'service_package',
        entityId: pacote!.id,
        metadata: { name: pacote!.name, itens: input.items.length },
        ...client,
      });
      return this.montar(tx, auth.organizationId, pacote!);
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdatePackageInput,
    client: ClientInfo,
  ): Promise<ServicePackage> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const pacote = await this.buscar(tx, auth.organizationId, id);

      const [atualizado] = await tx
        .update(servicePackages)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(servicePackages.organizationId, auth.organizationId), eq(servicePackages.id, pacote.id)))
        .returning();

      // a lista de itens é substituída inteira: editar linha a linha exigiria
      // identidade de linha que a tela não tem, e o pacote é pequeno
      if (input.items) {
        await tx
          .delete(servicePackageItems)
          .where(
            and(
              eq(servicePackageItems.organizationId, auth.organizationId),
              eq(servicePackageItems.packageId, pacote.id),
            ),
          );
        await this.gravarItens(tx, auth.organizationId, pacote.id, input.items);
      }

      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'package.updated',
        entityType: 'service_package',
        entityId: pacote.id,
        metadata: { name: atualizado!.name },
        ...client,
      });
      return this.montar(tx, auth.organizationId, atualizado!);
    });
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const pacote = await this.buscar(tx, auth.organizationId, id);
      // some da lista sem apagar o histórico de quem já usou
      await tx
        .update(servicePackages)
        .set({ deletedAt: new Date() })
        .where(and(eq(servicePackages.organizationId, auth.organizationId), eq(servicePackages.id, pacote.id)));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'package.deleted',
        entityType: 'service_package',
        entityId: pacote.id,
        metadata: { name: pacote.name },
        ...client,
      });
    });
  }

  // ------------------------------ internas --------------------------------

  private async buscar(tx: Tx, organizationId: string, id: string) {
    const [pacote] = await tx
      .select()
      .from(servicePackages)
      .where(
        and(
          eq(servicePackages.organizationId, organizationId),
          eq(servicePackages.id, id),
          isNull(servicePackages.deletedAt),
        ),
      )
      .limit(1);
    if (!pacote) throw notFound('Pacote não encontrado.');
    return pacote;
  }

  private async gravarItens(tx: Tx, organizationId: string, packageId: string, itens: CreatePackageInput['items']) {
    let posicao = 0;
    for (const item of itens) {
      if (item.serviceId) {
        const [servico] = await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.organizationId, organizationId),
              eq(services.id, item.serviceId),
              isNull(services.deletedAt),
            ),
          )
          .limit(1);
        if (!servico) throw validationFailed([{ path: 'body.items', message: 'Serviço não encontrado' }]);
      }
      if (item.partId) {
        const [peca] = await tx
          .select({ id: parts.id })
          .from(parts)
          .where(and(eq(parts.organizationId, organizationId), eq(parts.id, item.partId), isNull(parts.deletedAt)))
          .limit(1);
        if (!peca) throw validationFailed([{ path: 'body.items', message: 'Peça não encontrada' }]);
      }

      await tx.insert(servicePackageItems).values({
        organizationId,
        packageId,
        serviceId: item.serviceId,
        partId: item.partId,
        quantity: String(item.quantity),
        position: posicao++,
      });
    }
  }

  /** O pacote com o preço de HOJE, item por item. */
  private async montar(
    tx: Tx,
    organizationId: string,
    pacote: typeof servicePackages.$inferSelect,
  ): Promise<ServicePackage> {
    const settings = await readOrganizationSettings(tx, organizationId);
    const linhas = await tx
      .select({
        item: servicePackageItems,
        serviceName: services.name,
        servicePricingMode: services.pricingMode,
        servicePrice: services.priceCents,
        serviceMinutes: services.estimatedMinutes,
        serviceDeleted: services.deletedAt,
        serviceActive: services.isActive,
        partName: parts.name,
        partUnit: parts.unit,
        partPrice: parts.salePriceCents,
        partDeleted: parts.deletedAt,
      })
      .from(servicePackageItems)
      .leftJoin(
        services,
        and(eq(services.organizationId, servicePackageItems.organizationId), eq(services.id, servicePackageItems.serviceId)),
      )
      .leftJoin(
        parts,
        and(eq(parts.organizationId, servicePackageItems.organizationId), eq(parts.id, servicePackageItems.partId)),
      )
      .where(
        and(eq(servicePackageItems.organizationId, organizationId), eq(servicePackageItems.packageId, pacote.id)),
      )
      .orderBy(asc(servicePackageItems.position));

    const items: PackageItem[] = linhas.map((linha) => {
      const quantidade = milliToNumber(Number(linha.item.quantity) * 1000);
      if (linha.item.serviceId) {
        const preco =
          linha.servicePricingMode === null
            ? null
            : effectiveServicePrice(
                {
                  pricingMode: linha.servicePricingMode,
                  priceCents: linha.servicePrice,
                  estimatedMinutes: linha.serviceMinutes,
                },
                settings.laborRateCents,
              );
        return {
          id: linha.item.id,
          kind: 'SERVICE' as const,
          refId: linha.item.serviceId,
          name: linha.serviceName ?? 'Serviço removido',
          unit: null,
          quantity: quantidade,
          unitPriceCents: preco,
          unavailable: !linha.serviceName || Boolean(linha.serviceDeleted) || linha.serviceActive === false,
        };
      }
      return {
        id: linha.item.id,
        kind: 'PART' as const,
        refId: linha.item.partId!,
        name: linha.partName ?? 'Peça removida',
        unit: linha.partUnit,
        quantity: quantidade,
        unitPriceCents: linha.partPrice,
        unavailable: !linha.partName || Boolean(linha.partDeleted),
      };
    });

    return {
      id: pacote.id,
      name: pacote.name,
      description: pacote.description,
      isActive: pacote.isActive,
      items,
      // item que saiu do catálogo não entra no total: somar o preço de uma
      // peça que a oficina não vende mais é mostrar um número que não existe
      totalCents: items.reduce(
        (soma, item) =>
          soma + (item.unavailable || item.unitPriceCents === null ? 0 : Math.round(item.unitPriceCents * item.quantity)),
        0,
      ),
      createdAt: pacote.createdAt.toISOString(),
    };
  }

  /** Os itens que a OS vai receber. Usado pelo módulo de OS ao aplicar o pacote. */
  async itemsForWorkOrder(tx: Tx, organizationId: string, packageId: string) {
    const pacote = await this.buscar(tx, organizationId, packageId);
    if (!pacote.isActive) {
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Pacote desativado',
        'Este pacote está desativado. Ative-o no catálogo para usar de novo.',
      );
    }
    const linhas = await tx
      .select()
      .from(servicePackageItems)
      .where(and(eq(servicePackageItems.organizationId, organizationId), eq(servicePackageItems.packageId, packageId)))
      .orderBy(asc(servicePackageItems.position));
    return { pacote, linhas };
  }
}
