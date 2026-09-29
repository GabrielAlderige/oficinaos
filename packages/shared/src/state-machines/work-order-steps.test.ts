import { describe, expect, it } from 'vitest';
import { WORK_ORDER_STATUSES } from '../enums/work-orders';
import { availableActions } from './work-order';
import { nextAction, stepIndex, stepOf, WORK_ORDER_HAPPY_PATH, WORK_ORDER_NEXT_HINT, WORK_ORDER_STEPS } from './work-order-steps';

/**
 * Os degraus da OS (E33).
 *
 * O que precisa ficar provado: todo status sabe em que degrau está e o que
 * dizer em seguida (senão a tela fica muda justamente no estado esquecido), a
 * trilha só anda para a frente, e os DOIS finais não se confundem.
 */
describe('degraus da OS', () => {
  it('todo status tem degrau e tem frase — nenhum fica mudo', () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(WORK_ORDER_NEXT_HINT[status], `${status} sem frase`).toBeTruthy();
      if (status !== 'CANCELED') {
        expect(stepOf(status), `${status} sem degrau`).not.toBeNull();
      }
    }
    expect(stepOf('CANCELED'), 'cancelada saiu do caminho').toBeNull();
    expect(stepIndex('CANCELED')).toBe(-1);
  });

  it('a trilha só anda para a frente, na ordem do atendimento', () => {
    const caminho = ['OPEN', 'DIAGNOSING', 'AWAITING_QUOTE', 'AWAITING_APPROVAL', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'DELIVERED'] as const;
    const indices = caminho.map((status) => stepIndex(status));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!, `${caminho[i]} não pode voltar atrás de ${caminho[i - 1]}`).toBeGreaterThanOrEqual(indices[i - 1]!);
    }
    expect(stepIndex('OPEN')).toBe(0);
    expect(stepIndex('DELIVERED')).toBe(WORK_ORDER_STEPS.length - 1);
  });

  it('esperando peça continua na execução: é pausa, não degrau novo', () => {
    expect(stepOf('WAITING_PARTS')).toBe('EXECUCAO');
    expect(stepIndex('WAITING_PARTS')).toBe(stepIndex('IN_PROGRESS'));
  });

  it('os dois finais são diferentes, e a frase de cada um diz o que falta', () => {
    // "finalizar serviço" é o trabalho pronto; ENTREGAR é o cliente levar o carro
    expect(WORK_ORDER_NEXT_HINT.IN_PROGRESS).toContain('finalize o serviço');
    expect(WORK_ORDER_NEXT_HINT.COMPLETED).toContain('entregar o veículo');
    expect(WORK_ORDER_NEXT_HINT.COMPLETED, 'e que ainda há dinheiro a receber').toContain('receber');
    expect(WORK_ORDER_NEXT_HINT.DELIVERED).toContain('encerrada');
  });

  /**
   * A frase promete uma ação; a máquina de estados é quem entrega. Se alguém
   * mudar a máquina sem mudar a frase, a tela passa a mentir.
   */
  it('a frase de cada estado combina com a ação que a máquina realmente oferece', () => {
    const tudoPermitido = () => true;
    const rotulos = (status: (typeof WORK_ORDER_STATUSES)[number]) =>
      availableActions(status, tudoPermitido).map((acao) => acao.label.toLowerCase());

    expect(rotulos('IN_PROGRESS'), 'a máquina precisa oferecer finalizar').toContain('finalizar serviço');
    expect(rotulos('COMPLETED'), 'e depois entregar').toContain('entregar veículo');
    expect(rotulos('APPROVED'), 'aprovado começa o serviço').toContain('iniciar execução');
    expect(rotulos('DELIVERED'), 'entregue não tem mais para onde ir').toEqual([]);
  });

  /**
   * A ordem da máquina de estados NÃO é a do atendimento: nela "aguardando
   * peça" vem antes de "finalizar serviço". Quem pegar o primeiro da lista
   * oferece a exceção como próximo passo — foi o que aconteceu na E24.
   */
  it('o próximo passo nunca é a exceção nem voltar atrás', () => {
    const disponiveis = (status: (typeof WORK_ORDER_STATUSES)[number]) => availableActions(status, () => true);

    expect(nextAction(disponiveis('IN_PROGRESS'))?.action, 'e não aguardando peça').toBe('complete');
    expect(nextAction(disponiveis('APPROVED'))?.action).toBe('start');
    expect(nextAction(disponiveis('COMPLETED'))?.action, 'e não reabrir').toBe('deliver');
    expect(nextAction(disponiveis('WAITING_PARTS'))?.action, 'parado, o próximo é voltar a executar').toBe('start');
    expect(nextAction(disponiveis('DELIVERED')), 'entregue não tem próximo').toBeUndefined();

    expect(WORK_ORDER_HAPPY_PATH, 'exceção e volta atrás ficam de fora').not.toContain('wait-parts');
    expect(WORK_ORDER_HAPPY_PATH).not.toContain('cancel');
    expect(WORK_ORDER_HAPPY_PATH).not.toContain('reopen');
  });
});
