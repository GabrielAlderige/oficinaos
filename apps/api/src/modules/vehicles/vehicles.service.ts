import type { z } from 'zod';
import {
  can,
  canonicalPlate,
  canonicalPlatePrefix,
  type createVehicleSchema,
  ErrorCode,
  formatPlate,
  maskPhone,
  normalizePlate,
  type OdometerReading,
  type Page,
  type updateVehicleSchema,
  type Vehicle,
  type VehicleListItem,
  type vehicleListQuerySchema,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, pgConstraint } from '../../core/errors';
import { blankToNull, formatKm, isoOrNull } from '../../core/normalize';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as repo from './vehicles.repository';

type CreateInput = z.output<typeof createVehicleSchema>;
type UpdateInput = z.output<typeof updateVehicleSchema>;
type ListQuery = z.output<typeof vehicleListQuerySchema>;

const plateTaken = (plate: string, ownerName?: string) =>
  new AppError(
    409,
    ErrorCode.PLATE_ALREADY_REGISTERED,
    'Placa já cadastrada',
    ownerName
      ? `A placa ${formatPlate(plate)} já está cadastrada no veículo de ${ownerName}.`
      : `A placa ${formatPlate(plate)} já está cadastrada.`,
    [{ path: 'body.plate', message: ownerName ? `Já cadastrada no veículo de ${ownerName}` : 'Placa já cadastrada' }],
  );

/** Campos de texto do formulário → valores de gravação (placa normalizada + canônica). */
function toValues(input: Partial<CreateInput>) {
  const plate = input.plate === undefined ? undefined : input.plate.trim() === '' ? null : normalizePlate(input.plate);
  return {
    plate,
    plateCanonical: plate === undefined ? undefined : plate === null ? null : canonicalPlate(plate),
    make: input.make?.trim(),
    model: input.model?.trim(),
    version: blankToNull(input.version),
    engine: blankToNull(input.engine),
    color: blankToNull(input.color),
    yearManufacture: input.yearManufacture,
    yearModel: input.yearModel,
    fuel: input.fuel,
    transmission: input.transmission,
    vin: blankToNull(input.vin),
    notes: blankToNull(input.notes),
  };
}

export class VehiclesService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: ListQuery): Promise<Page<VehicleListItem>> {
    const { rows, total } = await withTenant(this.deps.db, auth, (tx) =>
      repo.listVehicles(tx, auth.organizationId, {
        q: query.q || undefined,
        customerId: query.customerId,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
    );
    return { data: rows, meta: { page: query.page, pageSize: query.pageSize, total } };
  }

  async listByCustomer(auth: AuthContext, customerId: string): Promise<VehicleListItem[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.findActiveCustomer(tx, auth.organizationId, customerId))) throw notFound('Cliente não encontrado.');
      return repo.listByCustomer(tx, auth.organizationId, customerId);
    });
  }

  /** Busca instantânea: "ABC1234" acha o carro cadastrado como "ABC1C34" (e vice-versa). */
  async lookup(auth: AuthContext, plate: string): Promise<VehicleListItem[]> {
    const prefix = canonicalPlatePrefix(plate);
    if (!prefix) return [];
    return withTenant(this.deps.db, auth, (tx) => repo.lookupByPlatePrefix(tx, auth.organizationId, prefix, 10));
  }

  async search(auth: AuthContext, q: string, limit: number): Promise<VehicleListItem[]> {
    return withTenant(this.deps.db, auth, (tx) => repo.searchVehicles(tx, auth.organizationId, q, limit));
  }

  async get(auth: AuthContext, id: string): Promise<Vehicle> {
    const found = await withTenant(this.deps.db, auth, (tx) => repo.findVehicle(tx, auth.organizationId, id));
    if (!found) throw notFound('Veículo não encontrado.');
    const { vehicle: v, owner } = found;
    return {
      id: v.id,
      customer: {
        id: owner.id,
        name: owner.name,
        whatsapp: can(auth.role, 'customers:view_contact') ? owner.whatsapp : maskPhone(owner.whatsapp),
      },
      plate: v.plate,
      make: v.make,
      model: v.model,
      version: v.version,
      engine: v.engine,
      color: v.color,
      yearManufacture: v.yearManufacture,
      yearModel: v.yearModel,
      fuel: v.fuel,
      transmission: v.transmission,
      vin: v.vin,
      odometerKm: v.odometerKm,
      odometerUpdatedAt: isoOrNull(v.odometerUpdatedAt),
      notes: v.notes,
      createdAt: v.createdAt.toISOString(),
      updatedAt: isoOrNull(v.updatedAt),
    };
  }

  async create(auth: AuthContext, input: CreateInput, client: ClientInfo): Promise<Vehicle> {
    const values = toValues(input);
    const id = await this.guardPlateRace(values.plate ?? null, () =>
      withTenant(this.deps.db, auth, async (tx) => {
        if (!(await repo.findActiveCustomer(tx, auth.organizationId, input.customerId))) {
          throw notFound('Cliente não encontrado.');
        }
        await this.assertPlateFree(tx, auth.organizationId, values.plateCanonical ?? null);

        const row = await repo.insertVehicle(tx, {
          ...values,
          organizationId: auth.organizationId,
          customerId: input.customerId,
          make: input.make.trim(),
          model: input.model.trim(),
          odometerKm: input.odometerKm,
          odometerUpdatedAt: input.odometerKm === null ? null : new Date(),
          createdBy: auth.userId,
        });
        if (input.odometerKm !== null) {
          await repo.insertReading(tx, {
            organizationId: auth.organizationId,
            vehicleId: row.id,
            km: input.odometerKm,
            source: 'MANUAL',
            recordedBy: auth.userId,
          });
        }
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'vehicle.created',
          entityType: 'vehicle',
          entityId: row.id,
          metadata: { plate: row.plate, customerId: input.customerId },
          ...client,
        });
        return row.id;
      }),
    );
    return this.get(auth, id);
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, client: ClientInfo): Promise<Vehicle> {
    const values = toValues(input);
    await this.guardPlateRace(values.plate ?? null, () =>
      withTenant(this.deps.db, auth, async (tx) => {
        const before = await repo.lockVehicle(tx, auth.organizationId, id);
        if (!before) throw notFound('Veículo não encontrado.');

        if (values.plateCanonical !== undefined && values.plateCanonical !== before.plateCanonical) {
          await this.assertPlateFree(tx, auth.organizationId, values.plateCanonical, id);
        }

        const patch: Partial<repo.VehicleRow> = { ...values };
        const km = input.odometerKm;
        if (km !== undefined && km !== before.odometerKm) {
          if (km !== null && before.odometerKm !== null && km < before.odometerKm && !input.confirmOdometerDecrease) {
            throw new AppError(
              422,
              ErrorCode.ODOMETER_DECREASE,
              'Quilometragem menor que a anterior',
              `A última quilometragem registrada é ${formatKm(before.odometerKm)}. Confirme se quer corrigir para ${formatKm(km)}.`,
              [{ path: 'body.odometerKm', message: `Menor que a última registrada (${formatKm(before.odometerKm)})` }],
            );
          }
          patch.odometerKm = km;
          patch.odometerUpdatedAt = km === null ? null : new Date();
          if (km !== null) {
            await repo.insertReading(tx, {
              organizationId: auth.organizationId,
              vehicleId: id,
              km,
              source: 'MANUAL',
              recordedBy: auth.userId,
            });
          }
        }

        const changes = diffChanges(before, { ...patch, odometerUpdatedAt: undefined });
        if (!Object.keys(changes).length) return;
        await repo.updateVehicle(tx, id, patch);
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'vehicle.updated',
          entityType: 'vehicle',
          entityId: id,
          changes,
          ...client,
        });
      }),
    );
    return this.get(auth, id);
  }

  /** Troca de dono: fica na auditoria; o histórico antigo continua com quem pagou cada serviço. */
  async transfer(auth: AuthContext, id: string, customerId: string, client: ClientInfo): Promise<Vehicle> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.lockVehicle(tx, auth.organizationId, id);
      if (!before) throw notFound('Veículo não encontrado.');
      if (before.customerId === customerId) return;
      const [from, to] = await Promise.all([
        repo.findActiveCustomer(tx, auth.organizationId, before.customerId),
        repo.findActiveCustomer(tx, auth.organizationId, customerId),
      ]);
      if (!to) throw notFound('Cliente não encontrado.');
      await repo.updateVehicle(tx, id, { customerId });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'vehicle.transferred',
        entityType: 'vehicle',
        entityId: id,
        changes: { customerId: { from: before.customerId, to: customerId } },
        metadata: { fromName: from?.name ?? null, toName: to.name },
        ...client,
      });
    });
    return this.get(auth, id);
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.lockVehicle(tx, auth.organizationId, id);
      if (!before) throw notFound('Veículo não encontrado.');
      await repo.softDeleteVehicle(tx, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'vehicle.deleted',
        entityType: 'vehicle',
        entityId: id,
        metadata: { plate: before.plate, make: before.make, model: before.model },
        ...client,
      });
    });
  }

  async readings(auth: AuthContext, id: string): Promise<OdometerReading[]> {
    const rows = await withTenant(this.deps.db, auth, async (tx) => {
      if (!(await repo.lockVehicle(tx, auth.organizationId, id))) throw notFound('Veículo não encontrado.');
      return repo.listReadings(tx, auth.organizationId, id);
    });
    return rows.map((row) => ({ ...row, recordedAt: row.recordedAt.toISOString() }));
  }

  private async assertPlateFree(tx: Tx, organizationId: string, canonical: string | null, exceptId?: string) {
    if (!canonical) return;
    const existing = await repo.findByCanonicalPlate(tx, organizationId, canonical, exceptId);
    if (existing) throw plateTaken(existing.plate ?? canonical, existing.customerName);
  }

  /** Duas pessoas cadastrando a mesma placa ao mesmo tempo: o índice único decide, a mensagem é a mesma. */
  private async guardPlateRace<T>(plate: string | null, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (plate && pgConstraint(err) === 'vehicles_org_plate_unique') throw plateTaken(plate);
      throw err;
    }
  }
}
