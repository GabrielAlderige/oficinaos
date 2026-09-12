import type { z } from 'zod';
import {
  can,
  type createPartSchema,
  ErrorCode,
  type InventorySummary,
  milliToDecimal,
  milliToNumber,
  type Movement,
  type OrganizationSettings,
  type Page,
  type Part,
  type PartApplication,
  type partApplicationInputSchema,
  type PartCategory,
  type partListQuerySchema,
  type PartListItem,
  parseQuantity,
  type stockMovementInputSchema,
  stockStatus,
  suggestedSalePrice,
  type updatePartSchema,
  weightedAverageCost,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, pgConstraint, validationFailed } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { readOrganizationSettings } from '../../core/org-settings';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as repo from './parts.repository';

type CreateInput = z.output<typeof createPartSchema>;
type UpdateInput = z.output<typeof updatePartSchema>;
type ListQuery = z.output<typeof partListQuerySchema>;
type ApplicationInput = z.output<typeof partApplicationInputSchema>;
type MovementInput = z.output<typeof stockMovementInputSchema>;

/** numeric do banco ("4.500") → milésimos. */
const milli = (value: string) => parseQuantity(value) ?? 0;
const toMilli = (value: number) => parseQuantity(value) ?? 0;

/** Custo e margem: dono, administrador, gerente e financeiro. Mecânico e atendente não. */
const canSeeCost = (auth: AuthContext) => can(auth.role, 'parts:view_cost');

const skuTaken = () =>
  new AppError(409, ErrorCode.PART_SKU_TAKEN, 'Código já usado', 'Já existe uma peça com este código interno.', [
    { path: 'body.sku', message: 'Já existe uma peça com este código' },
  ]);

const categoryTaken = () =>
  new AppError(409, ErrorCode.CATEGORY_NAME_TAKEN, 'Categoria já existe', 'Já existe uma categoria com este nome.', [
    { path: 'body.name', message: 'Já existe uma categoria com este nome' },
  ]);

function toPartDto(
  row: repo.PartRow,
  category: { id: string | null; name: string | null } | null,
  settings: OrganizationSettings,
  showCost: boolean,
): Part {
  const onHand = milli(row.quantityOnHand);
  const reserved = milli(row.quantityReserved);
  const min = milli(row.minQuantity);
  const cost = row.averageCostCents ?? row.lastCostCents;
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    manufacturerCode: row.manufacturerCode,
    manufacturer: row.manufacturer,
    category: category?.id && category.name ? { id: category.id, name: category.name } : null,
    description: row.description,
    unit: row.unit,
    ean: row.ean,
    salePriceCents: row.salePriceCents,
    markupBps: showCost ? row.markupBps : null,
    suggestedPriceCents:
      showCost && cost !== null ? suggestedSalePrice(cost, row.markupBps ?? settings.defaultMarkupBps) : null,
    costHidden: !showCost,
    lastCostCents: showCost ? row.lastCostCents : null,
    averageCostCents: showCost ? row.averageCostCents : null,
    quantityOnHand: milliToNumber(onHand),
    quantityReserved: milliToNumber(reserved),
    quantityAvailable: milliToNumber(onHand - reserved),
    minQuantity: milliToNumber(min),
    stockStatus: stockStatus({ trackStock: row.trackStock, onHandMilli: onHand, reservedMilli: reserved, minMilli: min }),
    location: row.location,
    trackStock: row.trackStock,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: isoOrNull(row.updatedAt),
  };
}

function toValues(input: Partial<CreateInput>) {
  return {
    name: input.name?.trim(),
    sku: blankToNull(input.sku),
    manufacturerCode: blankToNull(input.manufacturerCode),
    manufacturer: blankToNull(input.manufacturer),
    categoryId: input.categoryId,
    description: blankToNull(input.description),
    unit: input.unit,
    ean: blankToNull(input.ean),
    salePriceCents: input.salePriceCents,
    markupBps: input.markupBps,
    minQuantity: input.minQuantity === undefined ? undefined : milliToDecimal(toMilli(input.minQuantity)),
    location: blankToNull(input.location),
    trackStock: input.trackStock,
    isActive: input.isActive,
  };
}

function toMovementDto(
  row: {
    id: string;
    type: Movement['type'];
    quantity: string;
    unitCostCents: number | null;
    balanceAfter: string;
    reason: string | null;
    createdByName?: string | null;
    createdAt: Date;
  },
  showCost: boolean,
): Movement {
  return {
    id: row.id,
    type: row.type,
    quantity: milliToNumber(milli(row.quantity)),
    unitCostCents: showCost ? row.unitCostCents : null,
    balanceAfter: milliToNumber(milli(row.balanceAfter)),
    reason: row.reason,
    createdByName: row.createdByName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PartsService {
  constructor(private readonly deps: ServiceDeps) {}

  // ------------------------------------------------------------------ peças

  async list(auth: AuthContext, query: ListQuery): Promise<Page<PartListItem>> {
    const { rows, total } = await withTenant(this.deps.db, auth, (tx) =>
      repo.listParts(tx, auth.organizationId, {
        q: query.q || undefined,
        categoryId: query.categoryId,
        attentionOnly: query.stock === 'attention',
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
    );
    return {
      data: rows.map((row) => {
        const onHand = milli(row.quantityOnHand);
        const reserved = milli(row.quantityReserved);
        const min = milli(row.minQuantity);
        return {
          id: row.id,
          name: row.name,
          sku: row.sku,
          manufacturerCode: row.manufacturerCode,
          manufacturer: row.manufacturer,
          categoryName: row.categoryName,
          unit: row.unit,
          salePriceCents: row.salePriceCents,
          quantityOnHand: milliToNumber(onHand),
          quantityAvailable: milliToNumber(onHand - reserved),
          minQuantity: milliToNumber(min),
          stockStatus: stockStatus({ trackStock: row.trackStock, onHandMilli: onHand, reservedMilli: reserved, minMilli: min }),
          location: row.location,
        };
      }),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(auth: AuthContext, id: string): Promise<Part> {
    return withTenant(this.deps.db, auth, (tx) => this.loadDto(tx, auth, id));
  }

  async create(auth: AuthContext, input: CreateInput, client: ClientInfo): Promise<Part> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        await this.assertCategory(tx, auth.organizationId, input.categoryId);
        const initialMilli = input.trackStock ? toMilli(input.initialQuantity) : 0;
        const cost = input.initialUnitCostCents;

        const row = await repo.insertPart(tx, {
          ...toValues(input),
          organizationId: auth.organizationId,
          name: input.name.trim(),
          quantityOnHand: milliToDecimal(initialMilli),
          lastCostCents: cost,
          averageCostCents: cost,
          createdBy: auth.userId,
        });
        if (initialMilli > 0) {
          await repo.insertMovement(tx, {
            organizationId: auth.organizationId,
            partId: row.id,
            type: 'INITIAL',
            quantity: milliToDecimal(initialMilli),
            unitCostCents: cost,
            balanceAfter: milliToDecimal(initialMilli),
            averageCostAfterCents: cost,
            reason: 'Estoque no cadastro da peça',
            createdBy: auth.userId,
          });
        }
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'part.created',
          entityType: 'part',
          entityId: row.id,
          metadata: { name: row.name, initialQuantity: input.initialQuantity },
          ...client,
        });
        return this.loadDto(tx, auth, row.id);
      });
    } catch (err) {
      if (pgConstraint(err) === 'parts_org_sku_unique') throw skuTaken();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, client: ClientInfo): Promise<Part> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const before = await repo.lockPart(tx, auth.organizationId, id);
        if (!before) throw notFound('Peça não encontrada.');
        if (input.categoryId !== undefined) await this.assertCategory(tx, auth.organizationId, input.categoryId);

        const patch = toValues(input);
        // quem não vê custo não mexe em margem (receberia null e poderia apagar a margem sem saber)
        if (!canSeeCost(auth)) delete patch.markupBps;
        const changes = diffChanges(before, patch);
        if (Object.keys(changes).length) {
          await repo.updatePart(tx, id, patch);
          await recordActivity(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'part.updated',
            entityType: 'part',
            entityId: id,
            changes,
            ...client,
          });
        }
        return this.loadDto(tx, auth, id);
      });
    } catch (err) {
      if (pgConstraint(err) === 'parts_org_sku_unique') throw skuTaken();
      throw err;
    }
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.lockPart(tx, auth.organizationId, id);
      if (!before) throw notFound('Peça não encontrada.');
      await repo.softDeletePart(tx, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'part.deleted',
        entityType: 'part',
        entityId: id,
        metadata: { name: before.name, quantityOnHand: before.quantityOnHand },
        ...client,
      });
    });
  }

  // -------------------------------------------------------------- categorias

  async categories(auth: AuthContext): Promise<PartCategory[]> {
    return withTenant(this.deps.db, auth, (tx) => repo.listCategories(tx, auth.organizationId));
  }

  async createCategory(auth: AuthContext, name: string, client: ClientInfo): Promise<PartCategory> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const row = await repo.insertCategory(tx, auth.organizationId, name.trim());
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'part_category.created',
          entityType: 'part_category',
          entityId: row.id,
          metadata: { name: row.name },
          ...client,
        });
        return { id: row.id, name: row.name, partCount: 0 };
      });
    } catch (err) {
      if (pgConstraint(err) === 'part_categories_org_name_unique') throw categoryTaken();
      throw err;
    }
  }

  async renameCategory(auth: AuthContext, id: string, name: string, client: ClientInfo): Promise<PartCategory> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const before = await repo.findCategory(tx, auth.organizationId, id);
        if (!before) throw notFound('Categoria não encontrada.');
        const row = await repo.renameCategory(tx, id, name.trim());
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'part_category.renamed',
          entityType: 'part_category',
          entityId: id,
          changes: { name: { from: before.name, to: row.name } },
          ...client,
        });
        const found = (await repo.listCategories(tx, auth.organizationId)).find((c) => c.id === id);
        return { id: row.id, name: row.name, partCount: found?.partCount ?? 0 };
      });
    } catch (err) {
      if (pgConstraint(err) === 'part_categories_org_name_unique') throw categoryTaken();
      throw err;
    }
  }

  // --------------------------------------------------------------- aplicações

  async applications(auth: AuthContext, partId: string): Promise<PartApplication[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.findPart(tx, auth.organizationId, partId))) throw notFound('Peça não encontrada.');
      const rows = await repo.listApplications(tx, auth.organizationId, partId);
      return rows.map((r) => ({
        id: r.id,
        make: r.make,
        model: r.model,
        engine: r.engine,
        yearFrom: r.yearFrom,
        yearTo: r.yearTo,
        notes: r.notes,
      }));
    });
  }

  async addApplication(auth: AuthContext, partId: string, input: ApplicationInput, client: ClientInfo): Promise<PartApplication> {
    return withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.lockPart(tx, auth.organizationId, partId))) throw notFound('Peça não encontrada.');
      const row = await repo.insertApplication(tx, {
        organizationId: auth.organizationId,
        partId,
        make: input.make.trim(),
        model: blankToNull(input.model),
        engine: blankToNull(input.engine),
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        notes: blankToNull(input.notes),
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'part_application.added',
        entityType: 'part',
        entityId: partId,
        metadata: { make: row.make, model: row.model, yearFrom: row.yearFrom, yearTo: row.yearTo },
        ...client,
      });
      return {
        id: row.id,
        make: row.make,
        model: row.model,
        engine: row.engine,
        yearFrom: row.yearFrom,
        yearTo: row.yearTo,
        notes: row.notes,
      };
    });
  }

  async removeApplication(auth: AuthContext, partId: string, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.deleteApplication(tx, auth.organizationId, partId, id))) throw notFound('Aplicação não encontrada.');
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'part_application.removed',
        entityType: 'part',
        entityId: partId,
        metadata: { applicationId: id },
        ...client,
      });
    });
  }

  // ------------------------------------------------------------------ estoque

  async movements(auth: AuthContext, partId: string): Promise<Movement[]> {
    const rows = await withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.findPart(tx, auth.organizationId, partId))) throw notFound('Peça não encontrada.');
      return repo.listMovements(tx, auth.organizationId, partId, 100);
    });
    const showCost = canSeeCost(auth);
    return rows.map((row) => toMovementDto(row, showCost));
  }

  /**
   * Entrada (soma e recalcula o custo médio) ou ajuste de contagem (define o
   * saldo pelo que tem na prateleira, com motivo). A peça fica travada durante
   * a operação: duas entradas simultâneas nunca se sobrescrevem.
   */
  async move(auth: AuthContext, input: MovementInput, client: ClientInfo): Promise<{ part: Part; movement: Movement }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const part = await repo.lockPart(tx, auth.organizationId, input.partId);
      if (!part) throw notFound('Peça não encontrada.');
      if (!part.trackStock) {
        throw new AppError(422, ErrorCode.STOCK_NOT_TRACKED, 'Peça sem controle de estoque', 'Esta peça não controla estoque. Ative o controle na ficha da peça.');
      }

      const onHand = milli(part.quantityOnHand);
      let delta: number;
      let unitCost: number | null;
      let average = part.averageCostCents;
      let lastCost = part.lastCostCents;

      if (input.type === 'ENTRY') {
        delta = toMilli(input.quantity);
        unitCost = input.unitCostCents;
        if (unitCost !== null) {
          average = weightedAverageCost({ onHandMilli: onHand, averageCostCents: part.averageCostCents, inMilli: delta, unitCostCents: unitCost });
          lastCost = unitCost;
        }
      } else {
        const counted = toMilli(input.countedQuantity);
        delta = counted - onHand;
        if (delta === 0) {
          throw new AppError(422, ErrorCode.STOCK_NO_CHANGE, 'Nada para ajustar', 'A contagem é igual ao saldo atual: não há o que ajustar.');
        }
        unitCost = part.averageCostCents; // o ajuste é valorizado ao custo médio
      }

      const balance = onHand + delta;
      await repo.updatePart(tx, part.id, {
        quantityOnHand: milliToDecimal(balance),
        averageCostCents: average,
        lastCostCents: lastCost,
      });
      const movement = await repo.insertMovement(tx, {
        organizationId: auth.organizationId,
        partId: part.id,
        type: input.type === 'ENTRY' ? 'MANUAL_IN' : 'ADJUSTMENT',
        quantity: milliToDecimal(delta),
        unitCostCents: unitCost,
        balanceAfter: milliToDecimal(balance),
        averageCostAfterCents: average,
        reason: blankToNull(input.reason) ?? null,
        createdBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'inventory.moved',
        entityType: 'part',
        entityId: part.id,
        changes: { quantityOnHand: { from: part.quantityOnHand, to: milliToDecimal(balance) } },
        metadata: { type: movement.type, reason: movement.reason, unitCostCents: unitCost },
        ...client,
      });

      return {
        part: await this.loadDto(tx, auth, part.id),
        movement: toMovementDto({ ...movement, createdByName: null }, canSeeCost(auth)),
      };
    });
  }

  async summary(auth: AuthContext): Promise<InventorySummary> {
    const row = await withTenant(this.deps.db, auth, (tx) => repo.inventorySummary(tx, auth.organizationId));
    return {
      trackedParts: row.tracked,
      low: row.low,
      out: row.out,
      negative: row.negative,
      stockValueCents: canSeeCost(auth) ? Number(row.value) : null,
    };
  }

  // ---------------------------------------------------------------- internos

  private async loadDto(tx: Tx, auth: AuthContext, id: string): Promise<Part> {
    const found = await repo.findPart(tx, auth.organizationId, id);
    if (!found) throw notFound('Peça não encontrada.');
    const settings = await readOrganizationSettings(tx, auth.organizationId);
    return toPartDto(found.part, found.category, settings, canSeeCost(auth));
  }

  /** Categoria tem que ser desta oficina (a FK composta garante; aqui a mensagem fica clara). */
  private async assertCategory(tx: Tx, organizationId: string, categoryId: string | null) {
    if (categoryId && !(await repo.findCategory(tx, organizationId, categoryId))) {
      throw validationFailed([{ path: 'body.categoryId', message: 'Categoria não encontrada' }]);
    }
  }
}
