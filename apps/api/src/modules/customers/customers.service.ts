import type { z } from 'zod';
import {
  can,
  type Customer,
  type customerFormSchema,
  type CustomerListItem,
  ErrorCode,
  isValidCnpj,
  isValidCpf,
  type listQuerySchema,
  maskDocument,
  maskEmail,
  maskPhone,
  type Page,
  type SearchResult,
  type updateCustomerSchema,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, forbidden, notFound, pgConstraint, validationFailed } from '../../core/errors';
import {
  addressDto,
  blankToNull,
  documentOrNull,
  emailOrNull,
  isoOrNull,
  normalizeAddress,
  phoneOrNull,
} from '../../core/normalize';
import { withTenant } from '../../db/tenant';
import * as repo from './customers.repository';

type CreateInput = z.output<typeof customerFormSchema>;
type UpdateInput = z.output<typeof updateCustomerSchema>;
type ListQuery = z.output<typeof listQuerySchema>;

/** Mecânico vê nome e carro; contato vem mascarado (ARCHITECTURE §7). */
const canSeeContact = (auth: AuthContext) => can(auth.role, 'customers:view_contact');

const documentTaken = () =>
  new AppError(409, ErrorCode.CUSTOMER_DOCUMENT_TAKEN, 'Documento já cadastrado', 'Já existe um cliente com este CPF/CNPJ.', [
    { path: 'body.document', message: 'Já existe um cliente com este CPF/CNPJ' },
  ]);

function toValues(input: Partial<CreateInput>) {
  return {
    type: input.type,
    name: input.name?.trim(),
    document: documentOrNull(input.document),
    phone: phoneOrNull(input.phone),
    whatsapp: phoneOrNull(input.whatsapp),
    email: emailOrNull(input.email),
    address: input.address === undefined ? undefined : normalizeAddress(input.address),
    notes: blankToNull(input.notes),
    source: input.source === undefined ? undefined : input.source === '' ? null : input.source,
    marketingOptIn: input.marketingOptIn,
  };
}

function toDto(row: repo.CustomerRow, vehicleCount: number, visible: boolean): Customer {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    document: visible ? row.document : maskDocument(row.document),
    phone: visible ? row.phone : maskPhone(row.phone),
    whatsapp: visible ? row.whatsapp : maskPhone(row.whatsapp),
    email: visible ? row.email : maskEmail(row.email),
    address: addressDto(visible ? row.address : null),
    notes: row.notes,
    source: row.source,
    marketingOptIn: row.marketingOptIn,
    contactMasked: !visible,
    vehicleCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: isoOrNull(row.updatedAt),
  };
}

function assertDocumentMatchesType(type: string, document: string | null) {
  if (!document) return;
  if (type === 'PF' && !isValidCpf(document)) {
    throw validationFailed([{ path: 'body.document', message: 'Para pessoa física, informe um CPF válido' }]);
  }
  if (type === 'PJ' && !isValidCnpj(document)) {
    throw validationFailed([{ path: 'body.document', message: 'Para empresa, informe um CNPJ válido' }]);
  }
}

export class CustomersService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: ListQuery): Promise<Page<CustomerListItem>> {
    const { rows, total } = await withTenant(this.deps.db, auth, (tx) =>
      repo.listCustomers(tx, auth.organizationId, {
        q: query.q || undefined,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
    );
    const visible = canSeeContact(auth);
    return {
      data: rows.map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        document: visible ? row.document : maskDocument(row.document),
        whatsapp: visible ? row.whatsapp : maskPhone(row.whatsapp),
        phone: visible ? row.phone : maskPhone(row.phone),
        vehicleCount: row.vehicleCount,
        plates: row.plates ?? [],
        createdAt: row.createdAt.toISOString(),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(auth: AuthContext, id: string): Promise<Customer> {
    const found = await withTenant(this.deps.db, auth, (tx) => repo.findCustomer(tx, auth.organizationId, id));
    if (!found) throw notFound('Cliente não encontrado.');
    return toDto(found.customer, found.vehicleCount, canSeeContact(auth));
  }

  async create(auth: AuthContext, input: CreateInput, client: ClientInfo): Promise<Customer> {
    try {
      const row = await withTenant(this.deps.db, auth, async (tx) => {
        const row = await repo.insertCustomer(tx, {
          ...toValues(input),
          organizationId: auth.organizationId,
          type: input.type,
          name: input.name.trim(),
          createdBy: auth.userId,
        });
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'customer.created',
          entityType: 'customer',
          entityId: row.id,
          metadata: { name: row.name },
          ...client,
        });
        return row;
      });
      return toDto(row, 0, canSeeContact(auth));
    } catch (err) {
      if (pgConstraint(err) === 'customers_org_document_unique') throw documentTaken();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateInput, client: ClientInfo): Promise<Customer> {
    // quem edita precisa ver o contato: senão devolveria os valores mascarados como se fossem reais
    if (!canSeeContact(auth)) throw forbidden();
    try {
      const { row, vehicleCount } = await withTenant(this.deps.db, auth, async (tx) => {
        const before = await repo.lockCustomer(tx, auth.organizationId, id);
        if (!before) throw notFound('Cliente não encontrado.');

        const patch = toValues(input);
        assertDocumentMatchesType(patch.type ?? before.type, patch.document === undefined ? before.document : patch.document);

        const changes = diffChanges(before, patch);
        let row = before;
        if (Object.keys(changes).length) {
          row = await repo.updateCustomer(tx, id, patch);
          await recordActivity(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'customer.updated',
            entityType: 'customer',
            entityId: id,
            changes,
            ...client,
          });
        }
        return { row, vehicleCount: await repo.countVehicles(tx, auth.organizationId, id) };
      });
      return toDto(row, vehicleCount, true);
    } catch (err) {
      if (pgConstraint(err) === 'customers_org_document_unique') throw documentTaken();
      throw err;
    }
  }

  /** Apaga da lista (soft delete) o cliente e os carros dele; o histórico continua de pé. */
  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const before = await repo.lockCustomer(tx, auth.organizationId, id);
      if (!before) throw notFound('Cliente não encontrado.');
      const vehiclesRemoved = await repo.softDeleteCustomer(tx, auth.organizationId, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'customer.deleted',
        entityType: 'customer',
        entityId: id,
        metadata: { name: before.name, vehiclesRemoved },
        ...client,
      });
    });
  }

  async search(auth: AuthContext, q: string, limit: number): Promise<SearchResult['customers']> {
    const rows = await withTenant(this.deps.db, auth, (tx) =>
      repo.searchCustomers(tx, auth.organizationId, q, limit),
    );
    const visible = canSeeContact(auth);
    return rows.map((row) => ({ ...row, whatsapp: visible ? row.whatsapp : maskPhone(row.whatsapp) }));
  }
}
