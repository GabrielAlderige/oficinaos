import { describe, expect, it } from 'vitest';
import { bloqueiaEscrita, GRACE_DAYS, mensalEquivalente, precoDoCiclo, proximoVencimento, situacaoDaAssinatura } from './billing';

const AGORA = new Date('2026-09-20T12:00:00Z');
const emDias = (dias: number) => new Date(AGORA.getTime() + dias * 86_400_000);

describe('situação da assinatura', () => {
  const base = { trialEndsAt: null, currentPeriodEnd: null, pastDueSince: null };

  it('em teste, conta os dias que faltam e não bloqueia', () => {
    const s = situacaoDaAssinatura({ ...base, status: 'TRIALING', trialEndsAt: emDias(5) }, AGORA);
    expect(s.emTeste).toBe(true);
    expect(s.bloqueada).toBe(false);
    expect(s.diasRestantes).toBe(5);
  });

  it('teste vencido bloqueia a escrita', () => {
    const s = situacaoDaAssinatura({ ...base, status: 'TRIALING', trialEndsAt: emDias(-1) }, AGORA);
    expect(s.emTeste).toBe(false);
    expect(s.bloqueada).toBe(true);
    expect(bloqueiaEscrita(s)).toBe(true);
  });

  it('assinatura em dia nunca bloqueia', () => {
    const s = situacaoDaAssinatura({ ...base, status: 'ACTIVE', currentPeriodEnd: emDias(20) }, AGORA);
    expect(s.bloqueada).toBe(false);
    expect(s.diasRestantes).toBe(20);
  });

  it('pagamento atrasado dá carência antes de cortar', () => {
    const recem = situacaoDaAssinatura({ ...base, status: 'PAST_DUE', pastDueSince: emDias(-1) }, AGORA);
    expect(recem.emCarencia, 'atrasou ontem: a oficina continua trabalhando').toBe(true);
    expect(recem.bloqueada).toBe(false);
    expect(recem.diasRestantes).toBe(GRACE_DAYS - 1);

    const velho = situacaoDaAssinatura({ ...base, status: 'PAST_DUE', pastDueSince: emDias(-(GRACE_DAYS + 1)) }, AGORA);
    expect(velho.emCarencia).toBe(false);
    expect(velho.bloqueada, 'passou da carência: só leitura').toBe(true);
  });

  it('quem cancelou trabalha até o fim do que já pagou', () => {
    const dentro = situacaoDaAssinatura({ ...base, status: 'CANCELED', currentPeriodEnd: emDias(3) }, AGORA);
    expect(dentro.bloqueada).toBe(false);
    expect(dentro.diasRestantes).toBe(3);

    const depois = situacaoDaAssinatura({ ...base, status: 'CANCELED', currentPeriodEnd: emDias(-1) }, AGORA);
    expect(depois.bloqueada).toBe(true);
  });

  it('expirada é bloqueio, sem conversa', () => {
    expect(situacaoDaAssinatura({ ...base, status: 'EXPIRED' }, AGORA).bloqueada).toBe(true);
  });

  it('assinatura que não existe não bloqueia ninguém por acidente', () => {
    // status ACTIVE sem datas: é o estado de quem acabou de assinar
    expect(situacaoDaAssinatura({ ...base, status: 'ACTIVE' }, AGORA).bloqueada).toBe(false);
  });
});

describe('preço e ciclo', () => {
  const plano = { priceMonthlyCents: 19_900, priceYearlyCents: null };

  it('o ciclo anual só existe quando o plano tem preço anual', () => {
    expect(precoDoCiclo(plano, 'MONTHLY')).toBe(19_900);
    expect(precoDoCiclo(plano, 'YEARLY'), 'sem preço anual cadastrado, não se inventa desconto').toBeNull();
    expect(precoDoCiclo({ ...plano, priceYearlyCents: 199_000 }, 'YEARLY')).toBe(199_000);
  });

  it('o mensal equivalente do anual é o que a tela compara', () => {
    expect(mensalEquivalente(199_000)).toBe(16_583);
  });

  it('o próximo vencimento anda 30 dias no mensal e 365 no anual', () => {
    expect(proximoVencimento('2026-09-20', 'MONTHLY')).toBe('2026-10-20');
    expect(proximoVencimento('2026-09-20', 'YEARLY')).toBe('2027-09-20');
  });
});
