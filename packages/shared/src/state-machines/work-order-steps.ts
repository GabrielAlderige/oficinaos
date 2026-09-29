import type { WorkOrderStatus } from '../enums/work-orders';
import type { WorkOrderAction } from './work-order';

/**
 * Os degraus da OS, do jeito que a oficina conta (E33).
 *
 * A máquina de estados tem dez situações; quem está no balcão pensa em quatro
 * momentos. Este mapa existe para a tela poder dizer **onde a OS está e o que
 * falta para terminar** — que era a pergunta que ninguém conseguia responder
 * olhando uma fileira de botões todos iguais.
 *
 * Note que são DOIS finais, e confundi-los é o erro mais comum: "Finalizar
 * serviço" diz que o trabalho acabou; "Entregar veículo" diz que o cliente
 * levou o carro. Entre um e outro é onde se recebe.
 */
export const WORK_ORDER_STEPS = ['ABERTURA', 'ORCAMENTO', 'EXECUCAO', 'ENTREGA'] as const;
export type WorkOrderStep = (typeof WORK_ORDER_STEPS)[number];

export const WORK_ORDER_STEP_LABELS: Record<WorkOrderStep, string> = {
  ABERTURA: 'Abertura',
  ORCAMENTO: 'Orçamento',
  EXECUCAO: 'Execução',
  ENTREGA: 'Entrega',
};

const POR_STATUS: Record<WorkOrderStatus, WorkOrderStep | null> = {
  OPEN: 'ABERTURA',
  DIAGNOSING: 'ABERTURA',
  AWAITING_QUOTE: 'ORCAMENTO',
  AWAITING_APPROVAL: 'ORCAMENTO',
  APPROVED: 'EXECUCAO',
  IN_PROGRESS: 'EXECUCAO',
  WAITING_PARTS: 'EXECUCAO',
  COMPLETED: 'ENTREGA',
  DELIVERED: 'ENTREGA',
  // cancelada não está em degrau nenhum: ela saiu do caminho
  CANCELED: null,
};

export const stepOf = (status: WorkOrderStatus): WorkOrderStep | null => POR_STATUS[status];

/** Quantos degraus já ficaram para trás (para desenhar a trilha). */
export function stepIndex(status: WorkOrderStatus): number {
  const atual = stepOf(status);
  return atual ? WORK_ORDER_STEPS.indexOf(atual) : -1;
}

/**
 * Uma frase dizendo o que falta. É o texto que a tela mostra acima dos botões
 * — e ele fala do PRÓXIMO passo, não da situação atual, porque a situação já
 * está escrita na etiqueta ao lado do número da OS.
 */
export const WORK_ORDER_NEXT_HINT: Record<WorkOrderStatus, string> = {
  OPEN: 'Veja o carro e diga o que ele precisa. Depois monte o orçamento.',
  DIAGNOSING: 'Diagnóstico em andamento. Ao terminar, monte o orçamento com o que achou.',
  AWAITING_QUOTE: 'Itens lançados? Mande o orçamento para o cliente aprovar.',
  AWAITING_APPROVAL: 'Esperando o cliente responder. Se ele responder por telefone, registre aqui.',
  APPROVED: 'Aprovado. Pode começar o serviço.',
  IN_PROGRESS: 'Serviço em andamento. Quando o carro estiver pronto, finalize o serviço.',
  WAITING_PARTS: 'Parado esperando peça. Quando ela chegar, volte a executar.',
  COMPLETED: 'Carro pronto. Falta receber e entregar o veículo ao cliente.',
  DELIVERED: 'Entregue. Esta OS está encerrada.',
  CANCELED: 'Esta OS foi cancelada.',
};

/**
 * O caminho feliz, na ordem em que o serviço acontece.
 *
 * A ordem de `WORK_ORDER_ACTIONS` é a da máquina de estados, e nela
 * "aguardando peça" vem ANTES de "finalizar serviço" — quem escolher o
 * primeiro da lista como botão principal oferece a exceção no lugar do próximo
 * passo (foi o que aconteceu na E24, e de novo aqui). Esta lista existe para
 * a tela não precisar adivinhar.
 *
 * Fora dela ficam, de propósito: `wait-parts` (exceção), `cancel` e `reopen`
 * (voltar atrás) — nenhum deles é "o próximo passo" de coisa nenhuma.
 */
export const WORK_ORDER_HAPPY_PATH: WorkOrderAction[] = [
  'start-diagnosis',
  'finish-diagnosis',
  'start',
  'complete',
  'deliver',
];

/** A próxima ação do caminho feliz entre as que estão disponíveis agora. */
export function nextAction<T extends { action: WorkOrderAction }>(disponiveis: T[]): T | undefined {
  for (const acao of WORK_ORDER_HAPPY_PATH) {
    const achada = disponiveis.find((item) => item.action === acao);
    if (achada) return achada;
  }
  return undefined;
}
