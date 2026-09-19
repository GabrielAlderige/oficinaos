import {
  ErrorCode,
  LEAD_STAGES,
  normalizeBrazilianPhone,
  taxaDeConversaoBps,
  valorEmAbertoCents,
  whatsappLink,
  type Lead,
  type LeadInput,
  type LeadStage,
  type MoveLeadInput,
  type Pipeline,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { withTenant } from '../../db/tenant';
import * as customersRepo from '../customers/customers.repository';
import * as repo from './aftersales.repository';

const DIA = 86_400_000;

/**
 * CRM (E16). O funil existe porque a oficina perde negócio em silêncio: o
 * orçamento que não virou OS, a ligação que ficou no papel do balcão.
 *
 * Duas escolhas de produto:
 * - **Perder exige motivo.** Funil sem motivo de perda não ensina nada.
 * - **Fechar cria o cliente de verdade** (ou aponta para um que já existe),
 *   em vez de deixar dois cadastros do mesmo João no sistema.
 */
export class LeadsService {
  constructor(private readonly deps: ServiceDeps) {}

  async pipeline(auth: AuthContext, q?: string): Promise<Pipeline> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await repo.listLeads(tx, auth.organizationId, { q, limitPorEtapa: 50 });
      const agora = Date.now();
      const todos = linhas.map((linha) => toDto(linha, agora));

      const stages = LEAD_STAGES.map((stage) => {
        const daEtapa = todos.filter((lead) => lead.stage === stage);
        return {
          stage,
          count: daEtapa.length,
          valueCents: daEtapa.reduce((soma, lead) => soma + lead.estimatedValueCents, 0),
          leads: daEtapa,
        };
      });

      return {
        stages,
        openValueCents: valorEmAbertoCents(stages),
        conversionBps: taxaDeConversaoBps(stages),
      };
    });
  }

  async create(auth: AuthContext, input: LeadInput, client: ClientInfo): Promise<Lead> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const criado = await repo.insertLead(tx, {
        organizationId: auth.organizationId,
        name: input.name,
        phone: input.phone ? normalizeBrazilianPhone(input.phone) : null,
        source: input.source,
        vehicleDesc: blankToNull(input.vehicleDesc) ?? null,
        need: blankToNull(input.need) ?? null,
        estimatedValueCents: input.estimatedValueCents,
        notes: blankToNull(input.notes) ?? null,
        createdBy: auth.userId,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead.created',
        entityType: 'lead',
        entityId: criado.id,
        metadata: { name: criado.name, source: criado.source },
        ...client,
      });
      return toDto({ lead: criado, customerName: null }, Date.now());
    });
  }

  async update(auth: AuthContext, id: string, input: Partial<LeadInput>, client: ClientInfo): Promise<Lead> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findLead(tx, auth.organizationId, id);
      if (!atual) throw notFound('Contato não encontrado.');
      const atualizado = await repo.updateLead(tx, id, {
        ...input,
        phone: input.phone === undefined ? undefined : input.phone ? normalizeBrazilianPhone(input.phone) : null,
        vehicleDesc: input.vehicleDesc === undefined ? undefined : (blankToNull(input.vehicleDesc) ?? null),
        need: input.need === undefined ? undefined : (blankToNull(input.need) ?? null),
        notes: input.notes === undefined ? undefined : (blankToNull(input.notes) ?? null),
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead.updated',
        entityType: 'lead',
        entityId: id,
        metadata: { name: atualizado.name },
        ...client,
      });
      return toDto({ lead: atualizado, customerName: atual.customerName }, Date.now());
    });
  }

  /** Mover no funil. Perder exige motivo; fechar registra a data. */
  async move(auth: AuthContext, id: string, input: MoveLeadInput, client: ClientInfo): Promise<Lead> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findLead(tx, auth.organizationId, id);
      if (!atual) throw notFound('Contato não encontrado.');
      if (input.stage === 'LOST' && input.lostReason.trim().length < 3) {
        throw new AppError(
          422,
          ErrorCode.VALIDATION_FAILED,
          'Falta o motivo',
          'Diga por que este contato foi perdido: é o que o funil tem a ensinar.',
          [{ path: 'body.lostReason', message: 'Explique o motivo' }],
        );
      }
      const fechado = input.stage === 'WON' || input.stage === 'LOST';
      const atualizado = await repo.updateLead(tx, id, {
        stage: input.stage,
        lostReason: input.stage === 'LOST' ? input.lostReason.trim() : null,
        closedAt: fechado ? (atual.lead.closedAt ?? new Date()) : null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead.moved',
        entityType: 'lead',
        entityId: id,
        changes: { stage: { from: atual.lead.stage, to: input.stage } },
        metadata: { name: atualizado.name, lostReason: atualizado.lostReason },
        ...client,
      });
      return toDto({ lead: atualizado, customerName: atual.customerName }, Date.now());
    });
  }

  /**
   * O lead virou cliente. Sem `customerId`, cria o cadastro com o nome e o
   * telefone que já estão ali — digitar de novo é como nascem dois "João" no
   * sistema.
   */
  async convert(auth: AuthContext, id: string, customerId: string | null, client: ClientInfo): Promise<Lead> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findLead(tx, auth.organizationId, id);
      if (!atual) throw notFound('Contato não encontrado.');
      if (atual.lead.customerId) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Já virou cliente', 'Este contato já está ligado a um cliente.');
      }

      let alvo = customerId;
      if (alvo) {
        const cliente = await customersRepo.findCustomer(tx, auth.organizationId, alvo);
        if (!cliente) throw notFound('Cliente não encontrado.');
      } else {
        const criado = await customersRepo.insertCustomer(tx, {
          organizationId: auth.organizationId,
          name: atual.lead.name,
          whatsapp: atual.lead.phone,
          notes: [atual.lead.need, atual.lead.vehicleDesc].filter(Boolean).join(' · ') || null,
          createdBy: auth.userId,
        });
        alvo = criado.id;
      }

      const atualizado = await repo.updateLead(tx, id, {
        customerId: alvo,
        stage: 'WON',
        closedAt: atual.lead.closedAt ?? new Date(),
        lostReason: null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'lead.converted',
        entityType: 'lead',
        entityId: id,
        metadata: { name: atualizado.name, customerId: alvo, novoCliente: !customerId },
        ...client,
      });
      const comCliente = await repo.findLead(tx, auth.organizationId, id);
      return toDto(comCliente!, Date.now());
    });
  }
}

function toDto(linha: { lead: repo.LeadRow; customerName: string | null }, agora: number): Lead {
  const { lead } = linha;
  const mexido = (lead.updatedAt ?? lead.createdAt).getTime();
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    stage: lead.stage as LeadStage,
    source: lead.source,
    vehicleDesc: lead.vehicleDesc,
    need: lead.need,
    estimatedValueCents: lead.estimatedValueCents,
    notes: lead.notes,
    lostReason: lead.lostReason,
    customerId: lead.customerId,
    customerName: linha.customerName,
    whatsappUrl: lead.phone ? whatsappLink(lead.phone, '') : null,
    createdAt: lead.createdAt.toISOString(),
    closedAt: lead.closedAt?.toISOString() ?? null,
    idleDays: Math.max(0, Math.floor((agora - mexido) / DIA)),
  };
}
