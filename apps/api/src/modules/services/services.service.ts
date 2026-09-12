import type { z } from 'zod';
import {
  type createServiceSchema,
  effectiveServicePrice,
  ErrorCode,
  type Page,
  type Service,
  type serviceListQuerySchema,
  type updateServiceSchema,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, pgConstraint, validationFailed } from '../../core/errors';
import { blankToNull, isoOrNull } from '../../core/normalize';
import { readOrganizationSettings } from '../../core/org-settings';
import { withTenant } from '../../db/tenant';
import * as repo from './services.repository';

type CreateInput = z.output<typeof createServiceSchema>;
type UpdateInput = z.output<typeof updateServiceSchema>;
type ListQuery = z.output<typeof serviceListQuerySchema>;

const nameTaken = () =>
  new AppError(409, ErrorCode.SERVICE_NAME_TAKEN, 'Serviço já cadastrado', 'Já existe um serviço com este nome.', [
    { path: 'body.name', message: 'Já existe um serviço com este nome' },
  ]);

function toDto(row: repo.ServiceRow, laborRateCents: number | null): Service {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    pricingMode: row.pricingMode,
    priceCents: row.priceCents,
    estimatedMinutes: row.estimatedMinutes,
    effectivePriceCents: effectiveServicePrice(row, laborRateCents),
    intervalKm: row.intervalKm,
    intervalMonths: row.intervalMonths,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: isoOrNull(row.updatedAt),
  };
}

function toValues(input: Partial<CreateInput>) {
  return {
    name: input.name?.trim(),
    category: blankToNull(input.category),
    description: blankToNull(input.description),
    pricingMode: input.pricingMode,
    priceCents: input.priceCents,
    estimatedMinutes: input.estimatedMinutes,
    intervalKm: input.intervalKm,
    intervalMonths: input.intervalMonths,
    isActive: input.isActive,
  };
}

/** Preço fixo precisa de preço; por hora precisa de tempo padrão. Conferido com o que ficará gravado. */
function assertPricingComplete(mode: string, priceCents: number | null, estimatedMinutes: number | null) {
  if (mode === 'FIXED' && priceCents === null) {
    throw validationFailed([{ path: 'body.priceCents', message: 'Informe o preço' }]);
  }
  if (mode === 'HOURLY' && !estimatedMinutes) {
    throw validationFailed([{ path: 'body.estimatedMinutes', message: 'Informe o tempo padrão' }]);
  }
}

export class ServicesService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: ListQuery): Promise<Page<Service>> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const settings = await readOrganizationSettings(tx, auth.organizationId);
      const { rows, total } = await repo.listServices(tx, auth.organizationId, {
        q: query.q || undefined,
        status: query.status,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return {
        data: rows.map((row) => toDto(row, settings.laborRateCents)),
        meta: { page: query.page, pageSize: query.pageSize, total },
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<Service> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const row = await repo.findService(tx, auth.organizationId, id);
      if (!row) throw notFound('Serviço não encontrado.');
      return toDto(row, (await readOrganizationSettings(tx, auth.organizationId)).laborRateCents);
    });
  }

  async create(auth: AuthContext, input: CreateInput, client: ClientInfo): Promise<Service> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const row = await repo.insertService(tx, {
          ...toValues(input),
          organizationId: auth.organizationId,
          name: input.name.trim(),
          priceCents: input.pricingMode === 'FIXED' ? input.priceCents : null,
          createdBy: auth.userId,
        });
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'service.created',
          entityType: 'service',
          entityId: row.id,
          metadata: { name: row.name, priceCents: row.priceCents },
          ...client,
        });
        return toDto(row, (await readOrganizationSettings(tx, auth.organizationId)).laborRateCents);
      });
    } catch (err) {
      if (pgConstraint(err) === 'services_org_name_unique') throw nameTaken();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, client: ClientInfo): Promise<Service> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const before = await repo.findService(tx, auth.organizationId, id, true);
        if (!before) throw notFound('Serviço não encontrado.');

        const patch = toValues(input);
        const mode = patch.pricingMode ?? before.pricingMode;
        // no modo por hora o preço vem da hora técnica: não fica preço fixo "escondido" gravado
        if (mode === 'HOURLY') patch.priceCents = null;
        assertPricingComplete(
          mode,
          patch.priceCents === undefined ? before.priceCents : patch.priceCents,
          patch.estimatedMinutes === undefined ? before.estimatedMinutes : patch.estimatedMinutes,
        );

        const changes = diffChanges(before, patch);
        let row = before;
        if (Object.keys(changes).length) {
          row = await repo.updateService(tx, id, patch);
          // mudança de preço fica registrada: é o "quem alterou preço" do briefing
          await recordActivity(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'service.updated',
            entityType: 'service',
            entityId: id,
            changes,
            ...client,
          });
        }
        return toDto(row, (await readOrganizationSettings(tx, auth.organizationId)).laborRateCents);
      });
    } catch (err) {
      if (pgConstraint(err) === 'services_org_name_unique') throw nameTaken();
      throw err;
    }
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.findService(tx, auth.organizationId, id, true);
      if (!before) throw notFound('Serviço não encontrado.');
      await repo.softDeleteService(tx, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'service.deleted',
        entityType: 'service',
        entityId: id,
        metadata: { name: before.name },
        ...client,
      });
    });
  }
}
