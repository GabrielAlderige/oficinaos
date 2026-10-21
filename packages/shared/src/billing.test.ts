import { describe, expect, it } from 'vitest';
import {
  bloqueiaEscrita,
  fimDoTesteAoIniciar,
  GRACE_DAYS,
  mensalEquivalente,
  precoComFundadora,
  precoDoCiclo,
  proximoVencimento,
  situacaoDaAssinatura,
} from './billing';

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

  it('teste recém-vencido NÃO bloqueia: entra na carência', () => {
    // a armadilha que isto fecha (E41): antes, quem entrou numa segunda-feira
    // parava de gravar na segunda seguinte, no meio do expediente. Os 7 dias
    // só valiam para quem já pagava
    const s = situacaoDaAssinatura({ ...base, status: 'TRIALING', trialEndsAt: emDias(-1) }, AGORA);
    expect(s.emTeste, 'o teste acabou').toBe(false);
    expect(s.emCarencia, 'mas ainda trabalha').toBe(true);
    expect(s.bloqueada).toBe(false);
    expect(bloqueiaEscrita(s)).toBe(false);
    expect(s.diasRestantes, 'venceu ontem: sobram 6 dos 7').toBe(GRACE_DAYS - 1);
  });

  it('teste vencido há mais que a carência bloqueia a escrita', () => {
    const s = situacaoDaAssinatura(
      { ...base, status: 'TRIALING', trialEndsAt: emDias(-(GRACE_DAYS + 1)) },
      AGORA,
    );
    expect(s.emTeste).toBe(false);
    expect(s.emCarencia).toBe(false);
    expect(s.bloqueada).toBe(true);
    expect(bloqueiaEscrita(s), 'passou da carência: só leitura').toBe(true);
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

  it('quem cancelou no teste (sem nunca ter pago) trabalha até o fim do teste', () => {
    const noTeste = situacaoDaAssinatura({ ...base, status: 'CANCELED', trialEndsAt: emDias(10) }, AGORA);
    expect(noTeste.bloqueada, 'antes travava no mesmo minuto').toBe(false);
    expect(noTeste.diasRestantes).toBe(10);

    const acabou = situacaoDaAssinatura({ ...base, status: 'CANCELED', trialEndsAt: emDias(-1) }, AGORA);
    expect(acabou.bloqueada).toBe(true);
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

  it('o próximo vencimento anda um mês (ou um ano) de calendário, como o gateway', () => {
    expect(proximoVencimento('2026-09-20', 'MONTHLY')).toBe('2026-10-20');
    expect(proximoVencimento('2026-09-20', 'YEARLY')).toBe('2027-09-20');
    // com 30 dias fixos a tela dizia 20/01, e o Asaas cobrava em 21/01
    expect(proximoVencimento('2026-12-21', 'MONTHLY')).toBe('2027-01-21');
    expect(proximoVencimento('2027-01-31', 'MONTHLY'), 'fevereiro prende no último dia').toBe('2027-02-28');
    expect(proximoVencimento('2028-02-29', 'YEARLY')).toBe('2029-02-28');
  });
});

describe('fimDoTesteAoIniciar (D92)', () => {
  const agora = new Date('2026-10-20T13:00:00Z');
  const emDiasDe = (base: Date, dias: number) => new Date(base.getTime() + dias * 86_400_000);

  it('quem começa antes do 15º dia ganha os 30 dias a partir de agora', () => {
    const gravado = emDiasDe(agora, 40); // cadastro há 5 dias: 45 - 5
    expect(fimDoTesteAoIniciar(gravado, agora, 30)).toEqual(emDiasDe(agora, 30));
  });

  it('quem já estava em teste sozinho não ganha dias novos', () => {
    const gravado = emDiasDe(agora, 25); // cadastro há 20 dias: começou sozinho no 15º
    expect(fimDoTesteAoIniciar(gravado, agora, 30)).toEqual(gravado);
  });
});

describe('precoComFundadora (D92)', () => {
  const agora = new Date('2026-10-20T13:00:00Z');
  const fundadora = { priceCents: 27_900, until: new Date('2028-01-20T13:00:00Z'), plan: 'NITRO' };

  it('o Nitro mensal sai pelo preço travado', () => {
    expect(precoComFundadora(49_900, 'NITRO', 'MONTHLY', fundadora, agora)).toBe(27_900);
  });

  it('outro plano, o anual ou depois do prazo: preço da tabela', () => {
    expect(precoComFundadora(27_900, 'SUPERCHARGER', 'MONTHLY', fundadora, agora)).toBe(27_900);
    expect(precoComFundadora(499_000, 'NITRO', 'YEARLY', fundadora, agora)).toBe(499_000);
    expect(precoComFundadora(49_900, 'NITRO', 'MONTHLY', fundadora, new Date('2028-02-01T00:00:00Z'))).toBe(49_900);
  });

  it('quem não é fundadora paga a tabela', () => {
    expect(precoComFundadora(49_900, 'NITRO', 'MONTHLY', { priceCents: null, until: null, plan: 'NITRO' }, agora)).toBe(49_900);
  });
});
