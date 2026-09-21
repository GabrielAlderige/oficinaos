import {
  addDays,
  dayKey,
  diasDeAtraso,
  formatPlate,
  whatsappLink,
  whatsappMaintenanceMessage,
  whatsappNoReturnMessage,
  whatsappPostSaleMessage,
  type FollowUp,
  type FollowUpList,
  type FollowUpListQuery,
  type FollowUpType,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { notFound } from '../../core/errors';
import { blankToNull } from '../../core/normalize';
import { readTimezone } from '../../core/org-settings';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './aftersales.repository';
import { sincronizarFilaDePosVenda } from './follow-ups.sync';

/**
 * Pós-venda assistido (E16). A oficina não tem alguém para lembrar de ligar
 * para quem fez serviço semana passada — o sistema lembra, escreve a mensagem
 * e deixa o envio a UM toque. Quem aperta enviar é uma pessoa: automação sem
 * API não oficial, como manda o briefing.
 *
 * A fila é **recalculada ao abrir a tela**, não por um job de madrugada: sem
 * fila de jobs (pg-boss é da plataforma), isto é o que funciona hoje — e
 * quando houver job, ele vai chamar exatamente este `sincronizar`.
 */
export class FollowUpsService {
  constructor(private readonly deps: ServiceDeps) {}

  async list(auth: AuthContext, query: FollowUpListQuery): Promise<FollowUpList> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const timeZone = await readTimezone(tx, auth.organizationId);
      const hoje = dayKey(new Date(), timeZone);
      await sincronizarFilaDePosVenda(tx, auth.organizationId, hoje);

      const nome = (await orgRepo.findOrganization(tx, auth.organizationId))?.name ?? 'Oficina';
      const ateQuando =
        query.filter === 'today' ? hoje : query.filter === 'week' ? addDays(hoje, 7) : undefined;
      const linhas = await repo.listFollowUps(tx, auth.organizationId, {
        status: query.filter === 'done' ? ['DONE', 'SKIPPED'] : ['PENDING'],
        until: query.filter === 'done' || query.filter === 'all' ? undefined : ateQuando,
        type: query.type,
        limit: 100,
      });
      const counts = await repo.countFollowUps(tx, auth.organizationId, hoje, addDays(hoje, 7));

      return {
        data: linhas.map((linha) => this.toDto(linha, nome, hoje)),
        counts,
      };
    });
  }

  /** "Contatado": some da fila e fica no histórico, com o que aconteceu. */
  async done(auth: AuthContext, id: string, outcome: string, client: ClientInfo): Promise<{ ok: true }> {
    return this.encerrar(auth, id, 'DONE', outcome, client);
  }

  /** "Não precisa": o cliente pediu para não ligar, ou já foi resolvido por fora. */
  async skip(auth: AuthContext, id: string, outcome: string, client: ClientInfo): Promise<{ ok: true }> {
    return this.encerrar(auth, id, 'SKIPPED', outcome, client);
  }

  private async encerrar(
    auth: AuthContext,
    id: string,
    status: 'DONE' | 'SKIPPED',
    outcome: string,
    client: ClientInfo,
  ): Promise<{ ok: true }> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const atual = await repo.findFollowUp(tx, auth.organizationId, id);
      if (!atual) throw notFound('Contato não encontrado.');
      await repo.updateFollowUp(tx, id, {
        status,
        doneAt: new Date(),
        doneBy: auth.userId,
        outcome: blankToNull(outcome) ?? null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: status === 'DONE' ? 'follow_up.done' : 'follow_up.skipped',
        entityType: 'follow_up',
        entityId: id,
        metadata: { type: atual.type, outcome: outcome || null },
        ...client,
      });
      return { ok: true };
    });
  }

  private toDto(
    linha: Awaited<ReturnType<typeof repo.listFollowUps>>[number],
    shopName: string,
    hoje: string,
  ): FollowUp {
    const { followUp } = linha;
    const veiculo =
      linha.vehicleMake && linha.vehicleModel
        ? { make: linha.vehicleMake, model: linha.vehicleModel, plate: linha.vehiclePlate }
        : null;
    const mensagem = this.mensagem(followUp.type, {
      customerName: linha.customerName,
      shopName,
      vehicle: veiculo,
      reason: followUp.reason,
    });
    const telefone = linha.customerWhatsapp ?? linha.customerPhone;

    return {
      id: followUp.id,
      type: followUp.type,
      status: followUp.status,
      dueOn: followUp.dueOn,
      lateDays: followUp.status === 'PENDING' ? diasDeAtraso(followUp.dueOn, hoje) : 0,
      reason: followUp.reason,
      customerId: followUp.customerId,
      customerName: linha.customerName,
      customerWhatsapp: telefone,
      vehicleId: followUp.vehicleId,
      vehicleLabel: veiculo
        ? `${veiculo.make} ${veiculo.model}${veiculo.plate ? ` · ${formatPlate(veiculo.plate)}` : ''}`
        : null,
      workOrderId: followUp.workOrderId,
      workOrderNumber: linha.workOrderNumber,
      message: mensagem,
      whatsappUrl: telefone ? whatsappLink(telefone, mensagem) : null,
      doneAt: followUp.doneAt?.toISOString() ?? null,
      outcome: followUp.outcome,
    };
  }

  private mensagem(
    tipo: FollowUpType,
    dados: {
      customerName: string;
      shopName: string;
      vehicle: { make: string; model: string; plate: string | null } | null;
      reason: string | null;
    },
  ): string {
    if (tipo === 'POST_SALE_7D') {
      return whatsappPostSaleMessage({
        customerName: dados.customerName,
        shopName: dados.shopName,
        vehicle: dados.vehicle,
        // o motivo é "OS 182 — Troca de óleo": o serviço é o que vem depois do travessão
        serviceName: dados.reason?.split('—')[1]?.trim() ?? null,
      });
    }
    if (tipo === 'MAINTENANCE_DUE') {
      const [servico, quando] = (dados.reason ?? 'Revisão').split('—').map((parte) => parte.trim());
      return whatsappMaintenanceMessage({
        customerName: dados.customerName,
        shopName: dados.shopName,
        vehicle: dados.vehicle,
        serviceName: servico || 'Revisão',
        quando: quando?.replace('vence em', 'em') ?? 'em breve',
      });
    }
    return whatsappNoReturnMessage({
      customerName: dados.customerName,
      shopName: dados.shopName,
      vehicle: dados.vehicle,
    });
  }
}

