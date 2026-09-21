import {
  addDays,
  MAINTENANCE_LEAD_DAYS,
  NO_RETURN_MONTHS,
  POST_SALE_DAYS,
  proximaRevisao,
} from '@oficinaos/shared';
import type { Tx } from '../../db/tenant';
import * as repo from './aftersales.repository';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "vence em outubro": mês por extenso, que é como a oficina fala. */
export const mesDe = (dia: string) => `${MESES[Number(dia.slice(5, 7)) - 1]}`;

/**
 * Descobre quem contatar. Três perguntas, nesta ordem de valor:
 * 1. quem fez serviço há uma semana (o contato que fideliza);
 * 2. de quem a revisão está vencendo (o serviço que volta sozinho);
 * 3. quem sumiu há seis meses (o cliente que a oficina já perdeu sem saber).
 */
export async function sincronizarFilaDePosVenda(tx: Tx, org: string, hoje: string): Promise<number> {
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
