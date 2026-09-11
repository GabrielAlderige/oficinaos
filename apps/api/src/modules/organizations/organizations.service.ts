import type { z } from 'zod';
import type { Organization, updateOrganizationSchema } from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { addressDto, blankToNull, documentOrNull, emailOrNull, normalizeAddress, phoneOrNull } from '../../core/normalize';
import { withTenant } from '../../db/tenant';
import * as repo from './organizations.repository';

type UpdateInput = z.output<typeof updateOrganizationSchema>;

function toDto(row: repo.OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    document: row.document,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    address: addressDto(row.address),
    timezone: row.timezone,
    businessHours: row.businessHours ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

export class OrganizationsService {
  constructor(private readonly deps: ServiceDeps) {}

  async get(auth: AuthContext): Promise<Organization> {
    const row = await withTenant(this.deps.db, auth, (tx) => repo.findOrganization(tx, auth.organizationId));
    if (!row) throw notFound('Oficina não encontrada.');
    return toDto(row);
  }

  async update(auth: AuthContext, input: UpdateInput, client: ClientInfo): Promise<Organization> {
    const patch = {
      name: input.name?.trim(),
      legalName: blankToNull(input.legalName),
      document: documentOrNull(input.document),
      phone: phoneOrNull(input.phone),
      whatsapp: phoneOrNull(input.whatsapp),
      email: emailOrNull(input.email),
      address: input.address ? normalizeAddress(input.address) : undefined,
      timezone: input.timezone,
      businessHours: input.businessHours,
    };

    const row = await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.lockOrganization(tx, auth.organizationId);
      if (!before) throw notFound('Oficina não encontrada.');
      const changes = diffChanges(before, patch);
      if (!Object.keys(changes).length) return before;

      const updated = await repo.updateOrganization(tx, auth.organizationId, patch);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'organization.updated',
        entityType: 'organization',
        entityId: auth.organizationId,
        changes,
        ...client,
      });
      return updated;
    });
    return toDto(row);
  }
}
