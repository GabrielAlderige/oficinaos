import {
  ErrorCode,
  type Page,
  type Supplier,
  type SupplierInput,
  type SupplierListItem,
  type SupplierListQuery,
  type UpdateSupplierInput,
} from '@oficinaos/shared';
import { diffChanges, recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound, pgConstraint } from '../../core/errors';
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
import * as repo from './suppliers.repository';

const documentoEmUso = () =>
  new AppError(
    409,
    ErrorCode.SUPPLIER_DOCUMENT_TAKEN,
    'CNPJ já cadastrado',
    'Já existe um fornecedor com este CNPJ.',
    [{ path: 'body.document', message: 'Já existe um fornecedor com este CNPJ' }],
  );

/** Mesmas regras de normalização do cliente: telefone em E.164, vazio vira null. */
function paraGravar(input: Partial<SupplierInput>) {
  return {
    name: input.name?.trim(),
    legalName: blankToNull(input.legalName),
    document: documentOrNull(input.document),
    contactName: blankToNull(input.contactName),
    phone: phoneOrNull(input.phone),
    whatsapp: phoneOrNull(input.whatsapp),
    email: emailOrNull(input.email),
    address: input.address === undefined ? undefined : normalizeAddress(input.address),
    categories: input.categories,
    leadTimeDays: input.leadTimeDays,
    rating: input.rating,
    notes: blankToNull(input.notes),
  };
}

const paraTela = (row: repo.SupplierRow, preferredPartCount: number): Supplier => ({
  id: row.id,
  name: row.name,
  legalName: row.legalName,
  document: row.document,
  contactName: row.contactName,
  phone: row.phone,
  whatsapp: row.whatsapp,
  email: row.email,
  address: addressDto(row.address),
  categories: row.categories,
  leadTimeDays: row.leadTimeDays,
  rating: row.rating,
  notes: row.notes,
  preferredPartCount,
  createdAt: row.createdAt.toISOString(),
  updatedAt: isoOrNull(row.updatedAt),
});

/**
 * Fornecedores (MVP 2, E10). Diferente do cliente, não há contato mascarado: o
 * mecânico nem enxerga fornecedor (`suppliers:read`), e quem enxerga precisa do
 * telefone para ligar atrás da peça.
 */
export class SuppliersService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: SupplierListQuery): Promise<Page<SupplierListItem>> {
    const { rows, total } = await withTenant(this.deps.db, auth, (tx) =>
      repo.listSuppliers(tx, auth.organizationId, {
        q: query.q || undefined,
        category: query.category || undefined,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
    );
    return {
      data: rows.map(({ supplier, preferredPartCount }) => ({
        id: supplier.id,
        name: supplier.name,
        document: supplier.document,
        contactName: supplier.contactName,
        whatsapp: supplier.whatsapp,
        phone: supplier.phone,
        categories: supplier.categories,
        leadTimeDays: supplier.leadTimeDays,
        rating: supplier.rating,
        preferredPartCount,
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async get(auth: AuthContext, id: string): Promise<Supplier> {
    const found = await withTenant(this.deps.db, auth, (tx) => repo.findSupplier(tx, auth.organizationId, id));
    if (!found) throw notFound('Fornecedor não encontrado.');
    return paraTela(found.supplier, found.preferredPartCount);
  }

  async create(auth: AuthContext, input: SupplierInput, client: ClientInfo): Promise<Supplier> {
    try {
      const row = await withTenant(this.deps.db, auth, async (tx) => {
        const criado = await repo.insertSupplier(tx, {
          ...paraGravar(input),
          organizationId: auth.organizationId,
          name: input.name.trim(),
          categories: input.categories,
          createdBy: auth.userId,
        });
        await recordActivity(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action: 'supplier.created',
          entityType: 'supplier',
          entityId: criado.id,
          metadata: { name: criado.name },
          ...client,
        });
        return criado;
      });
      return paraTela(row, 0);
    } catch (err) {
      if (pgConstraint(err) === 'suppliers_org_document_unique') throw documentoEmUso();
      throw err;
    }
  }

  async update(auth: AuthContext, id: string, input: UpdateSupplierInput, client: ClientInfo): Promise<Supplier> {
    try {
      return await withTenant(this.deps.db, auth, async (tx) => {
        const antes = await repo.lockSupplier(tx, auth.organizationId, id);
        if (!antes) throw notFound('Fornecedor não encontrado.');

        const patch = paraGravar(input);
        const changes = diffChanges(antes, patch);
        if (Object.keys(changes).length) {
          await repo.updateSupplier(tx, id, patch);
          await recordActivity(tx, {
            organizationId: auth.organizationId,
            actorUserId: auth.userId,
            action: 'supplier.updated',
            entityType: 'supplier',
            entityId: id,
            changes,
            ...client,
          });
        }
        const found = await repo.findSupplier(tx, auth.organizationId, id);
        return paraTela(found!.supplier, found!.preferredPartCount);
      });
    } catch (err) {
      if (pgConstraint(err) === 'suppliers_org_document_unique') throw documentoEmUso();
      throw err;
    }
  }

  /** Sai da lista (soft delete); as peças que o tinham como preferido ficam sem preferido. */
  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const antes = await repo.lockSupplier(tx, auth.organizationId, id);
      if (!antes) throw notFound('Fornecedor não encontrado.');
      const pecasLiberadas = await repo.softDeleteSupplier(tx, auth.organizationId, id);
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'supplier.deleted',
        entityType: 'supplier',
        entityId: id,
        metadata: { name: antes.name, pecasLiberadas },
        ...client,
      });
    });
  }
}
