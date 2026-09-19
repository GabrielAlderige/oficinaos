import {
  addDays,
  dayKey,
  diasDeAtraso,
  formatPlate,
  MAINTENANCE_LEAD_DAYS,
  NO_RETURN_MONTHS,
  POST_SALE_DAYS,
  proximaRevisao,
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
import type { Tx } from '../../db/tenant';
import { withTenant } from '../../db/tenant';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './aftersales.repository';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

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
      await this.sincronizar(tx, auth, hoje);

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

  /**
   * Descobre quem contatar. Três perguntas, nesta ordem de valor:
   * 1. quem fez serviço há uma semana (o contato que fideliza);
   * 2. de quem a revisão está vencendo (o serviço que volta sozinho);
   * 3. quem sumiu há seis meses (o cliente que a oficina já perdeu sem saber).
   */
  private async sincronizar(tx: Tx, auth: AuthContext, hoje: string): Promise<number> {
    const org = auth.organizationId;
    const novos: Parameters<typeof repo.insertFollowUps>[1] = [];

    // 1) pós-venda: entregues entre 7 e 21 dias atrás (a janela evita ressuscitar
    //    o ano inteiro na primeira vez que a tela abre)
    const agora = new Date();
    const de = new Date(agora.getTime() - 21 * 86_400_000);
    const ate = new Date(agora.getTime() - POST_SALE_DAYS * 86_400_000);
    for (const linha of await repo.candidatosPosVenda(tx, org, de, ate)) {
      novos.push({
        organizationId: org,
        type: 'POST_SALE_7D',
        customerId: linha.customer_id,
        vehicleId: linha.vehicle_id,
        workOrderId: linha.work_order_id,
        dueOn: addDays(linha.delivered_on, POST_SALE_DAYS),
        reason: linha.servico ? `OS ${linha.number} — ${linha.servico}` : `OS ${linha.number}`,
        dedupeKey: `POST_SALE_7D:${linha.work_order_id}`,
      });
    }

    // 2) revisão vencendo: pelo intervalo do serviço, o que vencer primeiro
    for (const linha of await repo.candidatosRevisao(tx, org)) {
      const previsao = proximaRevisao({
        feitoEm: linha.feito_em,
        intervalMonths: linha.interval_months,
        intervalKm: linha.interval_km,
        kmNoServico: linha.km_no_servico,
        kmAtual: linha.km_atual,
      });
      if (!previsao) continue;
      const entraNaFila = addDays(previsao.dueOn, -MAINTENANCE_LEAD_DAYS);
      if (entraNaFila > hoje) continue;
      novos.push({
        organizationId: org,
        type: 'MAINTENANCE_DUE',
        customerId: linha.customer_id,
        vehicleId: linha.vehicle_id,
        workOrderId: linha.work_order_id,
        dueOn: entraNaFila,
        reason:
          previsao.kmRestantes !== null && previsao.kmRestantes <= (linha.interval_km ?? 0) / 4
            ? `${linha.service_name} — faltam ${Math.max(0, previsao.kmRestantes).toLocaleString('pt-BR')} km`
            : `${linha.service_name} — vence em ${mesDe(previsao.dueOn)}`,
        // a chave leva o vencimento: a revisão do ano que vem é outra conversa
        dedupeKey: `MAINTENANCE_DUE:${linha.vehicle_id}:${linha.service_id}:${previsao.dueOn.slice(0, 7)}`,
      });
    }

    // 3) sumidos: último serviço há mais de seis meses
    const limite = new Date(agora);
    limite.setMonth(limite.getMonth() - NO_RETURN_MONTHS);
    for (const linha of await repo.candidatosSemVoltar(tx, org, limite)) {
      novos.push({
        organizationId: org,
        type: 'NO_RETURN_6M',
        customerId: linha.customer_id,
        vehicleId: linha.vehicle_id,
        dueOn: hoje,
        reason: `Último serviço em ${mesDe(linha.ultima)}`,
        // uma conversa por semestre com o mesmo cliente, não uma por dia
        dedupeKey: `NO_RETURN_6M:${linha.customer_id}:${linha.ultima.slice(0, 7)}`,
      });
    }

    return repo.insertFollowUps(tx, novos);
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

const mesDe = (dia: string) => `${MESES[Number(dia.slice(5, 7)) - 1]}`;
