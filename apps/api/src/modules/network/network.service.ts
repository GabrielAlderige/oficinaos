import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  ErrorCode,
  milliToDecimal,
  parseQuantity,
  quantityMilliOf,
  TRIAL_AUTOSTART_DAYS,
  TRIAL_DAYS,
  TRIAL_PLAN,
  weightedAverageCost,
  type NetworkOverview,
  type StockTransferResult,
} from '@oficinaos/shared';
import type { z } from 'zod';
import type { createUnitSchema, networkQuerySchema, stockTransferSchema } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { checklistTemplates, inventoryMovements, partCategories, parts, services } from '../../db/schema';
import { withTenant, withUser, type Tx } from '../../db/tenant';
import * as authRepo from '../auth/auth.repository';
import type { DashboardService } from '../dashboard/dashboard.service';
import type { PartsService } from '../parts/parts.service';

const milli = (valor: string) => parseQuantity(valor) ?? 0;
const DA_REDE = new Set(['OWNER', 'ADMIN']);

/**
 * Troca a oficina do contexto NA MESMA transação. É o que deixa a
 * transferência atômica: a peça sai de uma unidade e entra na outra, ou nada
 * acontece. Só se chama depois de conferir que a pessoa é dona ou
 * administradora das DUAS oficinas.
 */
async function trocarDeOficina(tx: Tx, organizationId: string) {
  await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
}

/**
 * Várias unidades (E50). Ver `packages/shared/src/network.ts`.
 *
 * A rede não tem tabela: são as oficinas em que a pessoa é dona ou
 * administradora. Cada unidade continua isolada pelo RLS de sempre; o que
 * cruza unidades passa por aqui, sempre conferindo o vínculo nas duas pontas.
 */
export class NetworkService {
  constructor(
    private readonly deps: ServiceDeps,
    private readonly dashboard: DashboardService,
    private readonly partsService: PartsService,
  ) {}

  /** As unidades da rede de quem pergunta: dono ou administrador, oficina ativa. */
  private async unidades(auth: AuthContext) {
    const vinculos = await withUser(this.deps.db, auth.userId, (tx) => authRepo.listUserMemberships(tx, auth.userId));
    return vinculos.filter((vinculo) => DA_REDE.has(vinculo.role));
  }

  async overview(auth: AuthContext, query: z.output<typeof networkQuerySchema>): Promise<NetworkOverview> {
    const unidades = await this.unidades(auth);
    let periodo = { from: '', to: '' };
    const linhas: NetworkOverview['units'] = [];
    for (const unidade of unidades) {
      const ctx: AuthContext = { ...auth, organizationId: unidade.organizationId, role: unidade.role };
      const resumo = await this.dashboard.summary(ctx, { period: query.period });
      const estoque = await this.partsService.summary(ctx);
      if (unidade.organizationId === auth.organizationId) periodo = { from: resumo.period.from, to: resumo.period.to };
      linhas.push({
        id: unidade.organizationId,
        name: unidade.organizationName,
        role: unidade.role,
        isCurrent: unidade.organizationId === auth.organizationId,
        billedCents: resumo.billedCents ?? 0,
        receivedCents: resumo.receivedCents ?? 0,
        completedOrders: resumo.completedOrders,
        vehiclesInShop: resumo.vehiclesInShop,
        stockValueCents: estoque.stockValueCents,
      });
    }
    const soma = (campo: 'billedCents' | 'receivedCents' | 'completedOrders' | 'vehiclesInShop') =>
      linhas.reduce((total, linha) => total + linha[campo], 0);
    return {
      ...periodo,
      units: linhas,
      totals: {
        billedCents: soma('billedCents'),
        receivedCents: soma('receivedCents'),
        completedOrders: soma('completedOrders'),
        vehiclesInShop: soma('vehiclesInShop'),
        stockValueCents: linhas.reduce((total, linha) => total + (linha.stockValueCents ?? 0), 0),
      },
    };
  }

  /**
   * Abre a unidade nova: oficina, vínculo de dono, categorias, assinatura em
   * teste (a mesma do cadastro) e, se pedido, o catálogo da unidade atual —
   * serviços, peças SEM estoque e checklists. Tudo numa transação.
   */
  async createUnit(auth: AuthContext, input: z.output<typeof createUnitSchema>, client: ClientInfo): Promise<{ id: string; name: string }> {
    const novaId = uuidv7();
    await withTenant(this.deps.db, { organizationId: auth.organizationId, userId: auth.userId }, async (tx) => {
      const origem = auth.organizationId;
      const servicos = input.copyCatalog
        ? await tx.select().from(services).where(and(eq(services.organizationId, origem), isNull(services.deletedAt)))
        : [];
      const pecas = input.copyCatalog
        ? await tx.select().from(parts).where(and(eq(parts.organizationId, origem), isNull(parts.deletedAt)))
        : [];
      const categorias = input.copyCatalog
        ? await tx.select().from(partCategories).where(eq(partCategories.organizationId, origem))
        : [];
      const checklists = input.copyCatalog
        ? await tx
            .select()
            .from(checklistTemplates)
            .where(and(eq(checklistTemplates.organizationId, origem), isNull(checklistTemplates.deletedAt)))
        : [];

      await trocarDeOficina(tx, novaId);
      await authRepo.insertOrganization(tx, { id: novaId, name: input.name.trim(), whatsapp: input.whatsapp || null });
      await authRepo.insertMembership(tx, { organizationId: novaId, userId: auth.userId, role: 'OWNER' });
      await authRepo.insertDefaultPartCategories(tx, novaId);
      await authRepo.insertDefaultFinancialCategories(tx, novaId);
      const plano = await authRepo.findPlanByCode(tx, TRIAL_PLAN);
      if (!plano) throw new Error(`Plano ${TRIAL_PLAN} não existe: rode as migrations`);
      await authRepo.insertSubscription(tx, {
        organizationId: novaId,
        planId: plano.id,
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + (TRIAL_AUTOSTART_DAYS + TRIAL_DAYS) * 86_400_000),
        trialStartedAt: null,
      });

      if (input.copyCatalog) {
        // categorias pelo nome: as padrão já nasceram; as que a oficina criou, entram agora
        const existentes = await tx.select().from(partCategories).where(eq(partCategories.organizationId, novaId));
        const porNome = new Map(existentes.map((c) => [c.name.toLowerCase(), c.id]));
        for (const categoria of categorias) {
          if (!porNome.has(categoria.name.toLowerCase())) {
            const [criada] = await tx
              .insert(partCategories)
              .values({ organizationId: novaId, name: categoria.name, position: categoria.position })
              .returning();
            porNome.set(categoria.name.toLowerCase(), criada!.id);
          }
        }
        const categoriaDe = new Map(categorias.map((c) => [c.id, porNome.get(c.name.toLowerCase()) ?? null]));

        if (servicos.length) {
          await tx.insert(services).values(
            servicos.map((s) => ({
              organizationId: novaId,
              name: s.name,
              category: s.category,
              description: s.description,
              pricingMode: s.pricingMode,
              priceCents: s.priceCents,
              estimatedMinutes: s.estimatedMinutes,
              intervalKm: s.intervalKm,
              intervalMonths: s.intervalMonths,
              commissionBps: s.commissionBps,
              isActive: s.isActive,
              createdBy: auth.userId,
            })),
          );
        }
        if (pecas.length) {
          await tx.insert(parts).values(
            pecas.map((p) => ({
              organizationId: novaId,
              name: p.name,
              sku: p.sku,
              manufacturerCode: p.manufacturerCode,
              manufacturer: p.manufacturer,
              categoryId: p.categoryId ? (categoriaDe.get(p.categoryId) ?? null) : null,
              description: p.description,
              unit: p.unit,
              ean: p.ean,
              ncm: p.ncm,
              salePriceCents: p.salePriceCents,
              markupBps: p.markupBps,
              trackStock: p.trackStock,
              minQuantity: p.minQuantity,
              isActive: p.isActive,
              createdBy: auth.userId,
            })),
          );
        }
        if (checklists.length) {
          await tx.insert(checklistTemplates).values(
            checklists.map((c) => ({ organizationId: novaId, name: c.name, items: c.items, position: c.position, createdBy: auth.userId })),
          );
        }
      }

      await recordActivity(tx, {
        organizationId: novaId,
        actorUserId: auth.userId,
        action: 'organization.created',
        entityType: 'organization',
        entityId: novaId,
        metadata: { origem: 'rede', copiadoDe: input.copyCatalog ? origem : null, servicos: servicos.length, pecas: pecas.length },
        ...client,
      });
    });
    return { id: novaId, name: input.name.trim() };
  }

  /**
   * Transfere peças da unidade atual para outra da rede. A peça só sai do que
   * está DISPONÍVEL (o reservado para OS fica), entra na outra pelo custo
   * médio da origem, e — se a outra unidade não tinha a peça — é cadastrada
   * lá com o mesmo código. Atômico: as duas pontas ou nenhuma.
   */
  async transfer(auth: AuthContext, input: z.output<typeof stockTransferSchema>, client: ClientInfo): Promise<StockTransferResult> {
    if (input.toOrganizationId === auth.organizationId) {
      throw new AppError(422, ErrorCode.VALIDATION_FAILED, 'Mesma unidade', 'Escolha outra unidade para receber as peças.');
    }
    const unidades = await this.unidades(auth);
    const destino = unidades.find((u) => u.organizationId === input.toOrganizationId);
    const aqui = unidades.find((u) => u.organizationId === auth.organizationId);
    if (!destino || !aqui) {
      throw notFound('Unidade não encontrada na sua rede. Só dono ou administrador das duas unidades transfere.');
    }

    const transferId = uuidv7();
    const motivo = (direcao: string, nome: string) => [`${direcao} ${nome}`, input.notes].filter(Boolean).join(' · ');

    return withTenant(this.deps.db, { organizationId: auth.organizationId, userId: auth.userId }, async (tx) => {
      // ---------- origem: trava as peças e tira do disponível ----------
      const ids = [...new Set(input.items.map((item) => item.partId))].sort();
      const travadas = await tx
        .select()
        .from(parts)
        .where(and(eq(parts.organizationId, auth.organizationId), inArray(parts.id, ids), isNull(parts.deletedAt)))
        .orderBy(asc(parts.id))
        .for('update');
      if (travadas.length !== ids.length) throw notFound('Uma das peças não existe mais nesta unidade.');
      const pecas = new Map(travadas.map((p) => [p.id, { ...p, onHand: milli(p.quantityOnHand), reserved: milli(p.quantityReserved) }]));

      const saidas: { peca: (typeof travadas)[number]; quantidade: number; custo: number | null }[] = [];
      for (const item of input.items) {
        const peca = pecas.get(item.partId)!;
        const quantidade = quantityMilliOf(item.quantity);
        if (!peca.trackStock) {
          throw new AppError(422, ErrorCode.STOCK_NOT_TRACKED, 'Peça sem controle de estoque', `${peca.name} não controla estoque: não há o que transferir.`);
        }
        if (quantidade > peca.onHand - peca.reserved) {
          throw new AppError(
            422,
            ErrorCode.VALIDATION_FAILED,
            'Quantidade acima do disponível',
            `${peca.name}: só há ${(Math.max(0, peca.onHand - peca.reserved) / 1000).toLocaleString('pt-BR')} disponível (o reservado para OS fica).`,
          );
        }
        peca.onHand -= quantidade;
        await tx.insert(inventoryMovements).values({
          organizationId: auth.organizationId,
          partId: peca.id,
          type: 'TRANSFER_OUT',
          quantity: milliToDecimal(-quantidade),
          unitCostCents: peca.averageCostCents,
          balanceAfter: milliToDecimal(peca.onHand),
          averageCostAfterCents: peca.averageCostCents,
          transferId,
          reason: motivo('Para', destino.organizationName),
          createdBy: auth.userId,
        });
        saidas.push({ peca, quantidade, custo: peca.averageCostCents ?? peca.lastCostCents });
      }
      for (const peca of pecas.values()) {
        await tx.update(parts).set({ quantityOnHand: milliToDecimal(peca.onHand) }).where(eq(parts.id, peca.id));
      }
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'stock.transfer_out',
        entityType: 'stock_transfer',
        entityId: transferId,
        metadata: { para: destino.organizationName, itens: saidas.length },
        ...client,
      });

      // ---------- destino: acha (ou cadastra) a peça e soma no estoque ----------
      await trocarDeOficina(tx, input.toOrganizationId);
      const resultado: StockTransferResult['items'] = [];
      for (const saida of saidas) {
        const { peca } = saida;
        const filtro = peca.sku
          ? sql`lower(${parts.sku}) = lower(${peca.sku})`
          : sql`lower(${parts.name}) = lower(${peca.name})`;
        let [la] = await tx
          .select()
          .from(parts)
          .where(and(eq(parts.organizationId, input.toOrganizationId), isNull(parts.deletedAt), filtro))
          .limit(1)
          .for('update');
        let criada = false;
        if (!la) {
          [la] = await tx
            .insert(parts)
            .values({
              organizationId: input.toOrganizationId,
              name: peca.name,
              sku: peca.sku,
              manufacturerCode: peca.manufacturerCode,
              manufacturer: peca.manufacturer,
              description: peca.description,
              unit: peca.unit,
              ean: peca.ean,
              ncm: peca.ncm,
              salePriceCents: peca.salePriceCents,
              markupBps: peca.markupBps,
              trackStock: true,
              minQuantity: '0',
              createdBy: auth.userId,
            })
            .returning();
          criada = true;
        }
        const noDestino = milli(la!.quantityOnHand);
        const custo = saida.custo ?? la!.averageCostCents ?? 0;
        const medio = weightedAverageCost({ onHandMilli: noDestino, averageCostCents: la!.averageCostCents, inMilli: saida.quantidade, unitCostCents: custo });
        const saldo = noDestino + saida.quantidade;
        await tx.insert(inventoryMovements).values({
          organizationId: input.toOrganizationId,
          partId: la!.id,
          type: 'TRANSFER_IN',
          quantity: milliToDecimal(saida.quantidade),
          unitCostCents: custo,
          balanceAfter: milliToDecimal(saldo),
          averageCostAfterCents: medio,
          transferId,
          reason: motivo('De', aqui.organizationName),
          createdBy: auth.userId,
        });
        await tx
          .update(parts)
          .set({ quantityOnHand: milliToDecimal(saldo), averageCostCents: medio, lastCostCents: custo || la!.lastCostCents })
          .where(eq(parts.id, la!.id));
        resultado.push({ name: peca.name, quantity: saida.quantidade / 1000, createdAtDestination: criada });
      }
      await recordActivity(tx, {
        organizationId: input.toOrganizationId,
        actorUserId: auth.userId,
        action: 'stock.transfer_in',
        entityType: 'stock_transfer',
        entityId: transferId,
        metadata: { de: aqui.organizationName, itens: resultado.length },
        ...client,
      });
      return { transferId, toName: destino.organizationName, items: resultado };
    });
  }
}

