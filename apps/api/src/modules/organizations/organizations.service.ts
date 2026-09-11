import type { z } from 'zod';
import {
  normalizeBrazilianPhone,
  normalizeDocument,
  type Organization,
  type updateOrganizationSchema,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './organizations.repository';

type UpdateInput = z.output<typeof updateOrganizationSchema>;

/** Campo opcional de formulário: vazio vira null, ausente não mexe. */
const blankToNull = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() === '' ? null : value.trim();

const phoneOrNull = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() === '' ? null : normalizeBrazilianPhone(value);

function toDto(row: repo.OrganizationRow): Organization {
  const address = row.address ?? {};
  return {
    id: row.id,
    name: row.name,
    legalName: row.legalName,
    document: row.document,
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    address: {
      zip: address.zip ?? '',
      street: address.street ?? '',
      number: address.number ?? '',
      complement: address.complement ?? '',
      district: address.district ?? '',
      city: address.city ?? '',
      state: address.state ?? '',
    },
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
      document:
        input.document === undefined ? undefined : input.document.trim() === '' ? null : normalizeDocument(input.document),
      phone: phoneOrNull(input.phone),
      whatsapp: phoneOrNull(input.whatsapp),
      email: blankToNull(input.email)?.toLowerCase() ?? (input.email === undefined ? undefined : null),
      address: input.address ? { ...input.address, zip: input.address.zip.replace(/\D/g, '') } : undefined,
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
