import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { checklistKeys, type ChecklistTemplate, type ChecklistTemplateInput } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { checklistTemplates } from '../../db/schema';
import { withTenant, type Tx } from '../../db/tenant';

type Linha = typeof checklistTemplates.$inferSelect;

const dto = (linha: Linha): ChecklistTemplate => ({
  id: linha.id,
  name: linha.name,
  items: linha.items,
  position: linha.position,
});

/**
 * Checklists da oficina (E49). Ver `packages/shared/src/checklists.ts`.
 *
 * Apagar é lógico: o modelo some da lista, mas os check-ins feitos com ele
 * guardaram os itens inteiros e continuam mostrando tudo.
 */
export class ChecklistsService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext): Promise<ChecklistTemplate[]> {
    return withTenant(this.deps.db, auth, async (tx) => (await this.vivos(tx, auth.organizationId)).map(dto));
  }

  async create(auth: AuthContext, input: ChecklistTemplateInput, client: ClientInfo): Promise<ChecklistTemplate> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const { rows } = await tx.execute<{ next: number }>(sql`
        select coalesce(max(position) + 1, 0)::int as next
        from checklist_templates
        where organization_id = ${auth.organizationId} and deleted_at is null
      `);
      const [criado] = await tx
        .insert(checklistTemplates)
        .values({
          organizationId: auth.organizationId,
          name: input.name.trim(),
          items: checklistKeys(input.items),
          position: rows[0]?.next ?? 0,
          createdBy: auth.userId,
        })
        .returning();
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'checklist.created',
        entityType: 'checklist_template',
        entityId: criado!.id,
        metadata: { name: criado!.name, items: criado!.items.length },
        ...client,
      });
      return dto(criado!);
    });
  }

  async update(auth: AuthContext, id: string, input: ChecklistTemplateInput, client: ClientInfo): Promise<ChecklistTemplate> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await this.achar(tx, auth.organizationId, id);
      const [salvo] = await tx
        .update(checklistTemplates)
        .set({ name: input.name.trim(), items: checklistKeys(input.items), updatedAt: new Date() })
        .where(eq(checklistTemplates.id, atual.id))
        .returning();
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'checklist.updated',
        entityType: 'checklist_template',
        entityId: id,
        metadata: { name: salvo!.name, items: salvo!.items.length },
        ...client,
      });
      return dto(salvo!);
    });
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const atual = await this.achar(tx, auth.organizationId, id);
      await tx
        .update(checklistTemplates)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(checklistTemplates.id, atual.id));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'checklist.deleted',
        entityType: 'checklist_template',
        entityId: id,
        metadata: { name: atual.name },
        ...client,
      });
    });
  }

  /** A nova ordem da lista; o primeiro é o que o check-in abre sugerido. */
  async reorder(auth: AuthContext, ids: string[]): Promise<ChecklistTemplate[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const vivos = await this.vivos(tx, auth.organizationId);
      const conhecidos = new Set(vivos.map((linha) => linha.id));
      // o que não veio na lista vai para o fim, na ordem em que estava
      const ordem = [...ids.filter((id) => conhecidos.has(id)), ...vivos.map((l) => l.id).filter((id) => !ids.includes(id))];
      for (const [position, id] of [...new Set(ordem)].entries()) {
        await tx.update(checklistTemplates).set({ position }).where(eq(checklistTemplates.id, id));
      }
      return (await this.vivos(tx, auth.organizationId)).map(dto);
    });
  }

  private vivos(tx: Tx, organizationId: string) {
    return tx
      .select()
      .from(checklistTemplates)
      .where(and(eq(checklistTemplates.organizationId, organizationId), isNull(checklistTemplates.deletedAt)))
      .orderBy(asc(checklistTemplates.position), asc(checklistTemplates.createdAt));
  }

  private async achar(tx: Tx, organizationId: string, id: string): Promise<Linha> {
    const [linha] = await tx
      .select()
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.organizationId, organizationId),
          eq(checklistTemplates.id, id),
          isNull(checklistTemplates.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    if (!linha) throw notFound('Checklist não encontrado.');
    return linha;
  }
}
