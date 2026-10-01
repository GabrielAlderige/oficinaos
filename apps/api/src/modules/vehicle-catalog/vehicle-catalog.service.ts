import { and, asc, count, desc, eq, isNotNull, or, sql } from 'drizzle-orm';
import {
  type CatalogCoverage,
  type CatalogVehicle,
  type CatalogVehicleRequest,
  type CatalogVehicleSummary,
  type CreateCatalogVehicleInput,
  type RequestCatalogVehicleInput,
  SPEC_ITEM_BY_KEY,
  type UpdateCatalogVehicleInput,
  lerChassi,
  resumoDoChassi,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound, validationFailed } from '../../core/errors';
import { likeContains } from '../../core/normalize';
import { catalogVehicleRequests, catalogVehicles, catalogVehicleSpecs } from '../../db/schema';
import { withoutTenant, withPlatformAdmin, withTenant, type Tx } from '../../db/tenant';

/** "gol 2013" → casa marca/modelo/versão, e o ano dentro da faixa da ficha. */
function veiculoCombina(termo: string) {
  const palavras = termo.toLowerCase().split(/\s+/).filter(Boolean);
  if (!palavras.length) return undefined;

  const condicoes = palavras.map((palavra) => {
    const padrao = likeContains(palavra);
    const alternativas = [
      sql`immutable_unaccent(catalog_vehicles.make || ' ' || catalog_vehicles.model || ' ' || coalesce(catalog_vehicles.version, '')) ilike immutable_unaccent(${padrao})`,
    ];
    const ano = Number(palavra);
    if (/^\d{4}$/.test(palavra) && ano >= 1950 && ano <= 2100) {
      alternativas.push(sql`(
        (catalog_vehicles.year_from is null or catalog_vehicles.year_from <= ${ano})
        and (catalog_vehicles.year_to is null or catalog_vehicles.year_to >= ${ano})
      )`);
    }
    return or(...alternativas)!;
  });
  return and(...condicoes);
}

/**
 * Ficha do carro (E31) — o catálogo da plataforma.
 *
 * A oficina LÊ o que está publicado; quem escreve é administrador da
 * plataforma. O que ainda não existe não é escondido: a tela diz "em
 * desenvolvimento" e oferece pedir o carro, e esse pedido vira a fila de
 * prioridade de quem preenche. Prometer o que não se tem é o jeito mais
 * rápido de a oficina parar de consultar.
 */
export class VehicleCatalogService {
  constructor(private readonly deps: ServiceDeps) {}

  /** Quanto do catálogo já existe: a tela promete só o que pode cumprir. */
  async coverage(): Promise<CatalogCoverage> {
    return withoutTenant(this.deps.db, async (tx) => {
      const [linha] = await tx
        .select({ total: count() })
        .from(catalogVehicles)
        .where(isNotNull(catalogVehicles.publishedAt));
      return { publishedVehicles: linha?.total ?? 0 };
    });
  }

  async search(
    auth: AuthContext,
    input: { q?: string; incluirRascunhos: boolean; page: number; pageSize: number },
  ): Promise<{
    data: CatalogVehicleSummary[];
    meta: { page: number; pageSize: number; total: number };
    chassi?: { vin: string; make: string | null; years: number[]; resumo: string };
  }> {
    // rascunho só existe para quem preenche: a oficina não pode ver meia ficha
    const rascunhos = input.incluirRascunhos && auth.isPlatformAdmin;

    /**
     * Chassi no MESMO campo da busca (E43): quem cola 17 caracteres quer a
     * ficha daquele carro, não uma busca por texto. Dois campos obrigariam a
     * pessoa a escolher onde digitar antes de saber a diferença.
     *
     * O chassi entrega marca e ano — nunca o modelo, que é proprietário de
     * cada montadora. Então ele FILTRA a lista em vez de escolher a ficha: de
     * 292 para três ou quatro, e quem decide o modelo é quem está olhando.
     */
    const chassi = input.q ? lerChassi(input.q) : null;
    /**
     * O código do ano repete de 30 em 30 anos e o chassi não desempata, então
     * a ficha serve se cobrir QUALQUER um dos candidatos. Filtrar só pelo mais
     * recente esconderia a ficha do Gol 1997 ao ler o mesmo `V` de 2027.
     */
    const porChassi = chassi
      ? [
          ...(chassi.make ? [eq(catalogVehicles.make, chassi.make)] : []),
          ...(chassi.years.length
            ? [
                or(
                  ...chassi.years.map(
                    (ano) => sql`(
                      (catalog_vehicles.year_from is null or catalog_vehicles.year_from <= ${ano})
                      and (catalog_vehicles.year_to is null or catalog_vehicles.year_to >= ${ano})
                    )`,
                  ),
                ),
              ]
            : []),
        ]
      : [];

    const filtros = [
      ...(rascunhos ? [] : [isNotNull(catalogVehicles.publishedAt)]),
      ...(chassi ? porChassi : input.q ? [veiculoCombina(input.q)] : []),
    ].filter(Boolean);
    const onde = filtros.length ? and(...filtros) : undefined;

    return withoutTenant(this.deps.db, async (tx) => {
      const [total] = await tx.select({ total: count() }).from(catalogVehicles).where(onde);
      const linhas = await tx
        .select({
          veiculo: catalogVehicles,
          preenchidos: sql<number>`(
            select count(*)::int from catalog_vehicle_specs s where s.vehicle_id = catalog_vehicles.id
          )`,
        })
        .from(catalogVehicles)
        .where(onde)
        .orderBy(asc(catalogVehicles.make), asc(catalogVehicles.model), asc(catalogVehicles.yearFrom))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        data: linhas.map(({ veiculo, preenchidos }) => this.resumo(veiculo, preenchidos)),
        meta: { page: input.page, pageSize: input.pageSize, total: total?.total ?? 0 },
        ...(chassi
          ? {
              chassi: {
                vin: chassi.vin,
                make: chassi.make,
                years: chassi.years,
                resumo: resumoDoChassi(chassi),
              },
            }
          : {}),
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<CatalogVehicle> {
    return withoutTenant(this.deps.db, async (tx) => {
      const veiculo = await this.buscar(tx, id);
      if (!veiculo.publishedAt && !auth.isPlatformAdmin) throw notFound('Ficha não encontrada.');
      return this.montar(tx, veiculo);
    });
  }

  // --------------------------- só a plataforma ----------------------------

  async create(auth: AuthContext, input: CreateCatalogVehicleInput, client: ClientInfo): Promise<CatalogVehicle> {
    // o catálogo não tem RLS, mas a AUDITORIA tem: sem contexto de oficina o
    // registro de quem mexeu seria recusado pela policy de activity_logs
    return withTenant(this.deps.db, auth, async (tx) => {
      const [veiculo] = await tx
        .insert(catalogVehicles)
        .values({
          make: input.make,
          model: input.model,
          version: input.version || null,
          yearFrom: input.yearFrom,
          yearTo: input.yearTo,
          notes: input.notes || null,
          publishedAt: input.isPublished ? new Date() : null,
          createdBy: auth.userId,
        })
        .returning();

      await this.gravarSpecs(tx, veiculo!.id, input.specs);
      await this.registrar(tx, auth, 'catalog_vehicle.created', veiculo!.id, client, {
        veiculo: `${input.make} ${input.model}`,
      });
      return this.montar(tx, veiculo!);
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateCatalogVehicleInput,
    client: ClientInfo,
  ): Promise<CatalogVehicle> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const veiculo = await this.buscar(tx, id);
      const [atualizado] = await tx
        .update(catalogVehicles)
        .set({
          ...(input.make !== undefined ? { make: input.make } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.version !== undefined ? { version: input.version || null } : {}),
          ...(input.yearFrom !== undefined ? { yearFrom: input.yearFrom } : {}),
          ...(input.yearTo !== undefined ? { yearTo: input.yearTo } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          // publicar é ato datado: republicar não reescreve a data original
          ...(input.isPublished === undefined
            ? {}
            : { publishedAt: input.isPublished ? (veiculo.publishedAt ?? new Date()) : null }),
          updatedAt: new Date(),
        })
        .where(eq(catalogVehicles.id, id))
        .returning();

      // a lista é substituída inteira: a ficha é pequena e editada de uma vez
      if (input.specs) {
        await tx.delete(catalogVehicleSpecs).where(eq(catalogVehicleSpecs.vehicleId, id));
        await this.gravarSpecs(tx, id, input.specs);
      }

      await this.registrar(tx, auth, 'catalog_vehicle.updated', id, client, {
        veiculo: `${atualizado!.make} ${atualizado!.model}`,
        publicada: Boolean(atualizado!.publishedAt),
      });
      return this.montar(tx, atualizado!);
    });
  }

  async remove(auth: AuthContext, id: string, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      const veiculo = await this.buscar(tx, id);
      // as specs somem junto (FK on delete cascade): a ficha é uma coisa só
      await tx.delete(catalogVehicles).where(eq(catalogVehicles.id, id));
      await this.registrar(tx, auth, 'catalog_vehicle.deleted', id, client, {
        veiculo: `${veiculo.make} ${veiculo.model}`,
      });
    });
  }

  /** A fila de quem preenche: o carro mais pedido é o próximo. */
  async requests(): Promise<CatalogVehicleRequest[]> {
    return withPlatformAdmin(this.deps.db, async (tx) => {
      const linhas = await tx
        .select({
          id: sql<string>`min(${catalogVehicleRequests.id}::text)`,
          make: catalogVehicleRequests.make,
          model: catalogVehicleRequests.model,
          year: catalogVehicleRequests.year,
          note: sql<string | null>`max(${catalogVehicleRequests.note})`,
          requestCount: count(),
          lastRequestedAt: sql<Date>`max(${catalogVehicleRequests.createdAt})`,
        })
        .from(catalogVehicleRequests)
        .groupBy(catalogVehicleRequests.make, catalogVehicleRequests.model, catalogVehicleRequests.year)
        .orderBy(desc(count()), desc(sql`max(${catalogVehicleRequests.createdAt})`))
        .limit(200);

      return linhas.map((linha) => ({
        id: linha.id,
        make: linha.make,
        model: linha.model,
        year: linha.year,
        note: linha.note ?? '',
        requestCount: linha.requestCount,
        lastRequestedAt: new Date(linha.lastRequestedAt).toISOString(),
      }));
    });
  }

  // ---------------------------- pela oficina ------------------------------

  /** "Não achei o meu carro". A mesma oficina pedindo de novo não conta duas vezes. */
  async request(auth: AuthContext, input: RequestCatalogVehicleInput, client: ClientInfo): Promise<void> {
    await withTenant(this.deps.db, auth, async (tx) => {
      await tx
        .insert(catalogVehicleRequests)
        .values({
          organizationId: auth.organizationId,
          make: input.make,
          model: input.model,
          year: input.year,
          note: input.note || null,
          requestedBy: auth.userId,
        })
        .onConflictDoNothing();
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'catalog_vehicle.requested',
        entityType: 'catalog_vehicle_request',
        entityId: auth.organizationId,
        metadata: { veiculo: `${input.make} ${input.model}`, ano: input.year },
        ...client,
      });
    });
  }

  // ------------------------------ internas --------------------------------

  private async buscar(tx: Tx, id: string) {
    const [veiculo] = await tx.select().from(catalogVehicles).where(eq(catalogVehicles.id, id)).limit(1);
    if (!veiculo) throw notFound('Ficha não encontrada.');
    return veiculo;
  }

  private async gravarSpecs(tx: Tx, vehicleId: string, specs: CreateCatalogVehicleInput['specs']) {
    let posicao = 0;
    for (const spec of specs) {
      // ou é item da lista fixa (e a chave precisa existir), ou tem rótulo próprio
      if (spec.key && !SPEC_ITEM_BY_KEY.has(spec.key)) {
        throw validationFailed([{ path: 'body.specs', message: `Item desconhecido: ${spec.key}` }]);
      }
      if (!spec.key && !spec.customLabel) {
        throw validationFailed([{ path: 'body.specs', message: 'Item sem nome' }]);
      }
      await tx.insert(catalogVehicleSpecs).values({
        vehicleId,
        key: spec.key || null,
        customLabel: spec.customLabel || null,
        group: spec.group,
        value: spec.value,
        note: spec.note || null,
        source: spec.source || null,
        position: posicao++,
      });
    }
  }

  private resumo(veiculo: typeof catalogVehicles.$inferSelect, preenchidos: number): CatalogVehicleSummary {
    return {
      id: veiculo.id,
      make: veiculo.make,
      model: veiculo.model,
      version: veiculo.version ?? '',
      yearFrom: veiculo.yearFrom,
      yearTo: veiculo.yearTo,
      notes: veiculo.notes ?? '',
      isPublished: Boolean(veiculo.publishedAt),
      filledCount: preenchidos,
      updatedAt: (veiculo.updatedAt ?? veiculo.createdAt).toISOString(),
    };
  }

  private async montar(tx: Tx, veiculo: typeof catalogVehicles.$inferSelect): Promise<CatalogVehicle> {
    const specs = await tx
      .select()
      .from(catalogVehicleSpecs)
      .where(eq(catalogVehicleSpecs.vehicleId, veiculo.id))
      .orderBy(asc(catalogVehicleSpecs.position));

    return {
      ...this.resumo(veiculo, specs.length),
      specs: specs.map((spec) => ({
        key: spec.key ?? '',
        customLabel: spec.customLabel ?? '',
        group: spec.group,
        value: spec.value,
        note: spec.note ?? '',
        source: spec.source ?? '',
        updatedAt: spec.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * O catálogo é global, mas a auditoria é por oficina: registramos na oficina
   * de onde a pessoa estava — é o rastro de quem mexeu, que é o que importa.
   */
  private async registrar(
    tx: Tx,
    auth: AuthContext,
    action: string,
    entityId: string,
    client: ClientInfo,
    metadata: Record<string, unknown>,
  ) {
    await recordActivity(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action,
      entityType: 'catalog_vehicle',
      entityId,
      metadata,
      ...client,
    });
  }
}
