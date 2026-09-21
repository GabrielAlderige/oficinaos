/**
 * Regras puras das automações (E21). Mesma razão do `fiscal.ts` e do
 * `billing.ts`: o texto do resumo e a decisão de "está na hora?" aparecem no
 * job, na tela de configuração e no teste — e três cópias divergem.
 */

import type { AutomationKey } from './enums/automations';

/**
 * Já passou da hora de rodar hoje, no relógio da OFICINA?
 *
 * O job acorda de hora em hora; quem decide se roda é esta conta, comparando
 * a hora local com a hora escolhida e com a última execução. Sem isso, a
 * oficina de Manaus receberia o resumo às 5 da manhã.
 */
export function deveRodarAgora(input: {
  /** hora local da oficina, 0..23 */
  horaAgora: number;
  /** hora escolhida pela oficina */
  horaEscolhida: number;
  /** dia local da última execução ('YYYY-MM-DD'), ou null se nunca rodou */
  ultimaExecucaoEm: string | null;
  /** dia local de hoje */
  hoje: string;
}): boolean {
  if (input.ultimaExecucaoEm === input.hoje) return false;
  return input.horaAgora >= input.horaEscolhida;
}

export interface ResumoDoDia {
  shopName: string;
  /** contatos de pós-venda para hoje */
  contatosHoje: number;
  /** agendamentos de amanhã ainda não confirmados */
  agendamentosAmanha: number;
  /** orçamentos enviados sem resposta */
  orcamentosParados: number;
  /** veículos com previsão de entrega vencida */
  entregasAtrasadas: number;
  /** contas vencidas a receber, em centavos */
  aReceberVencidoCents: number;
  appUrl: string;
}

/** Só vale mandar e-mail se tiver o que dizer. */
export const temAlgoARelatar = (resumo: ResumoDoDia): boolean =>
  resumo.contatosHoje > 0 ||
  resumo.agendamentosAmanha > 0 ||
  resumo.orcamentosParados > 0 ||
  resumo.entregasAtrasadas > 0 ||
  resumo.aReceberVencidoCents > 0;

const brl = (cents: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const linha = (quantidade: number, singular: string, plural: string): string | null =>
  quantidade > 0 ? `- ${quantidade} ${quantidade === 1 ? singular : plural}` : null;

/**
 * O texto do resumo diário. É e-mail de trabalho: começa pelo que precisa de
 * decisão, não por saudação, e termina com o endereço do painel.
 */
export function textoDoResumoDiario(resumo: ResumoDoDia): string {
  const itens = [
    linha(resumo.contatosHoje, 'contato de pós-venda para hoje', 'contatos de pós-venda para hoje'),
    linha(resumo.agendamentosAmanha, 'agendamento de amanhã sem confirmar', 'agendamentos de amanhã sem confirmar'),
    linha(resumo.orcamentosParados, 'orçamento sem resposta', 'orçamentos sem resposta'),
    linha(resumo.entregasAtrasadas, 'veículo com entrega atrasada', 'veículos com entrega atrasada'),
    resumo.aReceberVencidoCents > 0 ? `- ${brl(resumo.aReceberVencidoCents)} vencidos a receber` : null,
  ].filter(Boolean);

  return [
    `Resumo do dia — ${resumo.shopName}`,
    '',
    itens.length ? itens.join('\n') : '- Nada pendente por aqui hoje.',
    '',
    `Abrir o painel: ${resumo.appUrl}`,
  ].join('\n');
}

/** O assunto do e-mail: o que mais pesa aparece já na caixa de entrada. */
export function assuntoDoResumoDiario(resumo: ResumoDoDia): string {
  const partes = [
    resumo.contatosHoje > 0 ? `${resumo.contatosHoje} contato${resumo.contatosHoje === 1 ? '' : 's'}` : null,
    resumo.orcamentosParados > 0
      ? `${resumo.orcamentosParados} orçamento${resumo.orcamentosParados === 1 ? '' : 's'} parado${resumo.orcamentosParados === 1 ? '' : 's'}`
      : null,
    resumo.entregasAtrasadas > 0 ? `${resumo.entregasAtrasadas} entrega atrasada` : null,
  ].filter(Boolean);
  return partes.length ? `OficinaOS: ${partes.join(', ')}` : 'OficinaOS: resumo do dia';
}

/** Ordem em que as automações rodam: a fila primeiro, o resumo por último. */
export const ORDEM_DAS_AUTOMACOES: AutomationKey[] = [
  'FOLLOW_UP_QUEUE',
  'APPOINTMENT_REMINDER',
  'QUOTE_NO_ANSWER',
  'DAILY_DIGEST',
];
