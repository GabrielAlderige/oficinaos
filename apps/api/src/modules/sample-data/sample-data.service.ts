import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { canonicalPlate, normalizePlate, type SampleDataStatus } from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError } from '../../core/errors';
import { ErrorCode } from '@oficinaos/shared';
import { customers, organizations, services, vehicles, workOrders } from '../../db/schema';
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import { softDeleteCustomer } from '../customers/customers.repository';

/** Onde ficam guardados os ids do exemplo, dentro de `organizations.settings`. */
const CHAVE = 'exemplo';

interface Guardado {
  customers: string[];
  services: string[];
  loadedAt: string;
}

/**
 * Os dados de exemplo da oferta Oficina Pronta (D92): quem escolhe configurar
 * sozinho pode encher o sistema com clientes, carros e serviços de mentira
 * para ver como as telas ficam, e apagar tudo com um botão.
 *
 * **Não tem OS de exemplo, de propósito.** O histórico da OS é prova (a linha
 * do tempo e a trilha são só de acréscimo): uma OS de mentira não sairia mais
 * do sistema, e a primeira OS de verdade da oficina nasceria com número 2.
 * Cliente, carro e serviço saem da lista sem deixar rastro (o mesmo "apagar"
 * de sempre, que só esconde).
 *
 * Os ids criados ficam guardados em `organizations.settings.exemplo`: apagar
 * remove exatamente o que foi criado aqui, e nada que a oficina cadastrou.
 * Os nomes levam "(exemplo)" para ninguém confundir com cliente de verdade.
 */
export class SampleDataService {
  constructor(private readonly deps: ServiceDeps) {}

  async status(auth: AuthContext): Promise<SampleDataStatus> {
    return withTenant(this.deps.db, auth, async (tx) => this.montar(await this.guardado(tx, auth.organizationId)));
  }

  async load(auth: AuthContext, client: ClientInfo): Promise<SampleDataStatus> {
    return withTenant(this.deps.db, auth, async (tx) => {
      // a linha da oficina travada: dois cliques não carregam o exemplo duas vezes
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, auth.organizationId)).for('update');
      if (await this.guardado(tx, auth.organizationId)) {
        throw new AppError(409, ErrorCode.CONFLICT, 'O exemplo já está carregado', 'Apague o exemplo antes de carregar de novo.');
      }

      const criadosClientes: string[] = [];
      for (const pessoa of PESSOAS) {
        const placa = canonicalPlate(pessoa.carro.placa);
        // a placa de exemplo já está em uso nesta oficina: pula o carro, não o exemplo inteiro
        const [ocupada] = placa
          ? await tx
              .select({ id: vehicles.id })
              .from(vehicles)
              .where(
                and(
                  eq(vehicles.organizationId, auth.organizationId),
                  eq(vehicles.plateCanonical, placa),
                  isNull(vehicles.deletedAt),
                ),
              )
              .limit(1)
          : [];
        const [cliente] = await tx
          .insert(customers)
          .values({
            organizationId: auth.organizationId,
            type: 'PF',
            name: pessoa.nome,
            whatsapp: null,
            notes: NOTA,
            createdBy: auth.userId,
          })
          .returning({ id: customers.id });
        criadosClientes.push(cliente!.id);
        if (!ocupada) {
          await tx.insert(vehicles).values({
            organizationId: auth.organizationId,
            customerId: cliente!.id,
            plate: normalizePlate(pessoa.carro.placa),
            plateCanonical: placa,
            make: pessoa.carro.marca,
            model: pessoa.carro.modelo,
            color: pessoa.carro.cor,
            yearManufacture: pessoa.carro.ano,
            yearModel: pessoa.carro.ano,
            odometerKm: pessoa.carro.km,
            odometerUpdatedAt: new Date(),
            notes: NOTA,
            createdBy: auth.userId,
          });
        }
      }

      const criadosServicos: string[] = [];
      for (const servico of SERVICOS) {
        // o índice único é por nome: um serviço que a oficina já tem não é duplicado
        const [existe] = await tx
          .select({ id: services.id })
          .from(services)
          .where(
            and(
              eq(services.organizationId, auth.organizationId),
              sql`lower(${services.name}) = lower(${servico.nome})`,
              isNull(services.deletedAt),
            ),
          )
          .limit(1);
        if (existe) continue;
        const [linha] = await tx
          .insert(services)
          .values({
            organizationId: auth.organizationId,
            name: servico.nome,
            category: servico.categoria,
            description: NOTA,
            pricingMode: 'FIXED',
            priceCents: servico.precoCents,
            estimatedMinutes: servico.minutos,
            createdBy: auth.userId,
          })
          .returning({ id: services.id });
        criadosServicos.push(linha!.id);
      }

      const guardado: Guardado = {
        customers: criadosClientes,
        services: criadosServicos,
        loadedAt: new Date().toISOString(),
      };
      await tx
        .update(organizations)
        .set({ settings: sql`${organizations.settings} || jsonb_build_object(${CHAVE}::text, ${JSON.stringify(guardado)}::jsonb)` })
        .where(eq(organizations.id, auth.organizationId));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'sample_data.loaded',
        entityType: 'organization',
        entityId: auth.organizationId,
        metadata: { customers: criadosClientes.length, services: criadosServicos.length },
        ...client,
      });
      return this.montar(guardado);
    });
  }

  /**
   * Apaga o exemplo. Cliente que já ganhou OS de verdade continua (com os
   * carros): a OS precisa do cliente para fazer sentido, e quem decide apagar
   * esse cliente agora é a oficina, pela tela de clientes.
   */
  async clear(auth: AuthContext, client: ClientInfo): Promise<SampleDataStatus> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, auth.organizationId)).for('update');
      const guardado = await this.guardado(tx, auth.organizationId);
      if (!guardado) return this.montar(null);

      const comOs = guardado.customers.length
        ? await tx
            .selectDistinct({ customerId: workOrders.customerId })
            .from(workOrders)
            .where(
              and(eq(workOrders.organizationId, auth.organizationId), inArray(workOrders.customerId, guardado.customers)),
            )
        : [];
      const manter = new Set(comOs.map((linha) => linha.customerId));

      let clientes = 0;
      for (const id of guardado.customers) {
        if (manter.has(id)) continue;
        await softDeleteCustomer(tx, auth.organizationId, id);
        clientes += 1;
      }
      if (guardado.services.length) {
        await tx
          .update(services)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(services.organizationId, auth.organizationId),
              inArray(services.id, guardado.services),
              isNull(services.deletedAt),
            ),
          );
      }
      await tx
        .update(organizations)
        .set({ settings: sql`${organizations.settings} - ${CHAVE}::text` })
        .where(eq(organizations.id, auth.organizationId));
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'sample_data.cleared',
        entityType: 'organization',
        entityId: auth.organizationId,
        metadata: { customers: clientes, kept: manter.size, services: guardado.services.length },
        ...client,
      });
      return { ...this.montar(null), kept: manter.size };
    });
  }

  private async guardado(tx: Tx, organizationId: string): Promise<Guardado | null> {
    const [linha] = await tx
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    const valor = linha?.settings?.[CHAVE] as Guardado | undefined;
    return valor && Array.isArray(valor.customers) && Array.isArray(valor.services) ? valor : null;
  }

  private montar(guardado: Guardado | null): SampleDataStatus {
    return {
      loaded: guardado !== null,
      customers: guardado?.customers.length ?? 0,
      services: guardado?.services.length ?? 0,
      loadedAt: guardado?.loadedAt ?? null,
      kept: 0,
    };
  }
}

const NOTA = 'Exemplo do OficinaOS. Apague em Início → Dados de exemplo quando cadastrar os seus.';

/** Placas no formato Mercosul, começando por EXE: não colidem com carro de verdade. */
const PESSOAS = [
  { nome: 'Maria Souza (exemplo)', carro: { placa: 'EXE1A01', marca: 'Chevrolet', modelo: 'Onix', cor: 'Branco', ano: 2019, km: 68_400 } },
  { nome: 'João Pereira (exemplo)', carro: { placa: 'EXE2B02', marca: 'Volkswagen', modelo: 'Gol', cor: 'Prata', ano: 2015, km: 121_300 } },
  { nome: 'Carlos Lima (exemplo)', carro: { placa: 'EXE3C03', marca: 'Hyundai', modelo: 'HB20', cor: 'Preto', ano: 2021, km: 39_800 } },
] as const;

/** Preços de exemplo: a oficina troca pelos dela (o nome avisa). */
const SERVICOS = [
  { nome: 'Troca de óleo e filtro (exemplo)', categoria: 'Revisão', precoCents: 9_000, minutos: 30 },
  { nome: 'Alinhamento e balanceamento (exemplo)', categoria: 'Suspensão', precoCents: 12_000, minutos: 60 },
  { nome: 'Troca de pastilha dianteira (exemplo)', categoria: 'Freios', precoCents: 15_000, minutos: 60 },
  { nome: 'Diagnóstico com scanner (exemplo)', categoria: 'Elétrica', precoCents: 10_000, minutos: 30 },
] as const;
