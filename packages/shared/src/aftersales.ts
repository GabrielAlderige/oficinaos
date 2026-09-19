/**
 * Regras puras do pós-venda, das avaliações e do CRM (E16). A API decide com
 * elas e a tela mostra a mesma conta — inclusive as mensagens, que precisam
 * sair iguais no painel e no registro do que foi enviado.
 */

import { addDays } from './calendar';
import type { LeadStage } from './enums/aftersales';
import { OPEN_LEAD_STAGES } from './enums/aftersales';
import { formatPlate } from './br/plate';

const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;
const comPlaca = (vehicle: { make: string; model: string; plate: string | null }) =>
  `${vehicle.make} ${vehicle.model}${vehicle.plate ? ` (${formatPlate(vehicle.plate)})` : ''}`;

// ------------------------------- pós-venda -------------------------------

/**
 * A mensagem de uma semana depois. Pergunta aberta de propósito: "ficou bom?"
 * puxa resposta; "estamos à disposição" não puxa nada.
 */
export function whatsappPostSaleMessage(input: {
  customerName: string;
  shopName: string;
  vehicle: { make: string; model: string; plate: string | null } | null;
  serviceName: string | null;
}): string {
  const carro = input.vehicle ? ` do seu ${comPlaca(input.vehicle)}` : '';
  const servico = input.serviceName ? ` (${input.serviceName})` : '';
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    `Passando para saber como ficou o serviço${carro}${servico}. Está tudo certo com o carro?`,
    'Se aparecer qualquer coisa, me chama por aqui que a gente resolve.',
  ].join('\n\n');
}

/** Revisão vencendo, pelo km ou pelo tempo. */
export function whatsappMaintenanceMessage(input: {
  customerName: string;
  shopName: string;
  vehicle: { make: string; model: string; plate: string | null } | null;
  serviceName: string;
  /** "em outubro" ou "nos próximos 500 km" */
  quando: string;
}): string {
  const carro = input.vehicle ? ` do ${comPlaca(input.vehicle)}` : '';
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    `A ${input.serviceName.toLowerCase()}${carro} está chegando ${input.quando}.`,
    'Quer que eu já separe um horário? Me diga o melhor dia que eu reservo.',
  ].join('\n\n');
}

/** Cliente sumido. Sem promoção inventada: só a porta aberta. */
export function whatsappNoReturnMessage(input: {
  customerName: string;
  shopName: string;
  vehicle: { make: string; model: string; plate: string | null } | null;
}): string {
  const carro = input.vehicle ? ` o ${comPlaca(input.vehicle)}` : ' o carro';
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    `Faz um tempo que não vemos${carro} por aqui. Está tudo bem com ele?`,
    'Se quiser uma revisão ou só tirar uma dúvida, é só responder por aqui.',
  ].join('\n\n');
}

/** O convite para avaliar. Vai para TODO mundo, não só para quem gostou. */
export function whatsappReviewInviteMessage(input: {
  customerName: string;
  shopName: string;
  url: string;
}): string {
  return [
    `Olá, ${primeiroNome(input.customerName)}! Aqui é da ${input.shopName}.`,
    'Você consegue avaliar o atendimento? São 30 segundos e ajuda muito a gente a melhorar:',
    input.url,
  ].join('\n\n');
}

// ------------------------------ manutenção -------------------------------

/**
 * Quando a próxima revisão vence, pelo que vier primeiro: o intervalo de km
 * ou o de meses. Devolve a data prevista e, quando dá, quanto falta de km.
 *
 * Sem intervalo nenhum no serviço, não há revisão a lembrar — e inventar uma
 * data seria mandar o cliente vir à toa.
 */
export function proximaRevisao(input: {
  /** data do serviço, "AAAA-MM-DD" */
  feitoEm: string;
  intervalMonths: number | null;
  intervalKm: number | null;
  kmNoServico: number | null;
  kmAtual: number | null;
  /** média de km por dia; sem histórico, 40 km/dia é o uso urbano típico */
  kmPorDia?: number;
}): { dueOn: string; kmRestantes: number | null } | null {
  const { feitoEm, intervalMonths, intervalKm, kmNoServico, kmAtual } = input;
  if (!intervalMonths && !intervalKm) return null;

  const porTempo = intervalMonths ? addMeses(feitoEm, intervalMonths) : null;

  let porKm: string | null = null;
  let kmRestantes: number | null = null;
  if (intervalKm && kmNoServico !== null && kmAtual !== null && kmAtual >= kmNoServico) {
    const alvo = kmNoServico + intervalKm;
    kmRestantes = alvo - kmAtual;
    const kmPorDia = input.kmPorDia && input.kmPorDia > 0 ? input.kmPorDia : 40;
    porKm = addDays(hojeOuFeito(feitoEm), Math.max(0, Math.round(kmRestantes / kmPorDia)));
  }

  const candidatas = [porTempo, porKm].filter((data): data is string => data !== null);
  if (!candidatas.length) return null;
  return { dueOn: candidatas.sort()[0]!, kmRestantes };
}

const hojeOuFeito = (feitoEm: string) => feitoEm;

/** Soma meses a "AAAA-MM-DD", prendendo no último dia do mês. */
function addMeses(dia: string, meses: number): string {
  const [ano, mes, data] = dia.split('-').map(Number);
  const alvo = new Date(Date.UTC(ano!, mes! - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  const diaFinal = Math.min(data!, ultimo);
  return `${alvo.getUTCFullYear()}-${String(alvo.getUTCMonth() + 1).padStart(2, '0')}-${String(diaFinal).padStart(2, '0')}`;
}

// ---------------------------------- CRM ----------------------------------

export interface FunilPorEtapa {
  stage: LeadStage;
  count: number;
  valueCents: number;
}

/**
 * A taxa de conversão do funil: ganhos sobre o que já foi DECIDIDO (ganhos +
 * perdidos). Contar os que ainda estão em conversa como perda faria o número
 * cair toda vez que entra lead novo — e ninguém melhora o que não entende.
 */
export function taxaDeConversaoBps(etapas: readonly FunilPorEtapa[]): number {
  const total = (stage: LeadStage) => etapas.find((etapa) => etapa.stage === stage)?.count ?? 0;
  const decididos = total('WON') + total('LOST');
  return decididos ? Math.round((total('WON') / decididos) * 10_000) : 0;
}

/** O que ainda está vivo no funil, em valor: é o que o dono chama de "pipeline". */
export function valorEmAbertoCents(etapas: readonly FunilPorEtapa[]): number {
  return etapas
    .filter((etapa) => OPEN_LEAD_STAGES.includes(etapa.stage))
    .reduce((soma, etapa) => soma + etapa.valueCents, 0);
}

/** Média das notas, arredondada a uma casa (4,3 — não 4,2857). */
export function mediaDasNotas(notas: readonly number[]): number {
  if (!notas.length) return 0;
  return Math.round((notas.reduce((soma, nota) => soma + nota, 0) / notas.length) * 10) / 10;
}
