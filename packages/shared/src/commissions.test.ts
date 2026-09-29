import { describe, expect, it } from 'vitest';
import {
  comissaoDoItemCents,
  comissaoGanhaCents,
  comissaoPorMecanico,
  formatBps,
  origemDaComissao,
  parseBps,
  percentualDaComissao,
} from './commissions';

/**
 * Comissão do mecânico (E26). O que precisa ficar provado: qual percentual
 * vence, que peça não entra, que o dinheiro que não entrou não vira comissão,
 * e que uma OS de dois mecânicos paga cada um pelo que fez.
 */
describe('qual percentual vale', () => {
  it('o do serviço ganha do mecânico, que ganha do da oficina', () => {
    expect(percentualDaComissao({ servicoBps: 1500, mecanicoBps: 1200, oficinaBps: 1000 })).toBe(1500);
    expect(percentualDaComissao({ servicoBps: null, mecanicoBps: 1200, oficinaBps: 1000 })).toBe(1200);
    expect(percentualDaComissao({ servicoBps: null, mecanicoBps: null, oficinaBps: 1000 })).toBe(1000);
  });

  it('zero é uma escolha, não "não configurado"', () => {
    // serviço que a oficina decidiu não comissionar: 0% vence os 10% do padrão
    expect(percentualDaComissao({ servicoBps: 0, mecanicoBps: 1200, oficinaBps: 1000 })).toBe(0);
    expect(percentualDaComissao({ servicoBps: null, mecanicoBps: 0, oficinaBps: 1000 })).toBe(0);
  });

  it('a tela consegue dizer de onde veio o número', () => {
    expect(origemDaComissao({ servicoBps: 1500, mecanicoBps: 1200, oficinaBps: 1000 })).toBe('SERVICE');
    expect(origemDaComissao({ servicoBps: null, mecanicoBps: 1200, oficinaBps: 1000 })).toBe('MECHANIC');
    expect(origemDaComissao({ servicoBps: null, mecanicoBps: null, oficinaBps: 1000 })).toBe('ORGANIZATION');
  });
});

describe('a conta da comissão', () => {
  it('é sobre o valor do item, arredondada ao centavo', () => {
    expect(comissaoDoItemCents(18_000, 1200)).toBe(2160);
    // 333,33 × 12,5% = 41,66625 → 41,67
    expect(comissaoDoItemCents(33_333, 1250)).toBe(4167);
  });

  it('percentual zero ou valor negativo não viram dinheiro', () => {
    expect(comissaoDoItemCents(18_000, 0)).toBe(0);
    expect(comissaoDoItemCents(-500, 1200)).toBe(0);
  });
});

describe('ganha conforme o cliente paga', () => {
  it('pagamento pela metade gera metade da comissão', () => {
    expect(comissaoGanhaCents(15_660, 34_000, 68_000)).toBe(7830);
  });

  it('OS quitada gera a comissão inteira', () => {
    expect(comissaoGanhaCents(15_660, 68_000, 68_000)).toBe(15_660);
  });

  it('fiado não gera comissão nenhuma', () => {
    expect(comissaoGanhaCents(15_660, 0, 68_000)).toBe(0);
  });

  it('cliente que pagou a mais não gera comissão extra', () => {
    expect(comissaoGanhaCents(15_660, 90_000, 68_000), 'a fração para em 1').toBe(15_660);
  });

  it('OS de valor zero não divide por zero', () => {
    expect(comissaoGanhaCents(0, 0, 0)).toBe(0);
  });
});

describe('OS com dois mecânicos', () => {
  const zé = 'a1111111-1111-4111-8111-111111111111';
  const maria = 'b2222222-2222-4222-8222-222222222222';

  it('cada um recebe pelo que fez', () => {
    const porMecanico = comissaoPorMecanico([
      { totalCents: 18_000, commissionBps: 1200, mechanicUserId: zé },
      { totalCents: 90_000, commissionBps: 1500, mechanicUserId: zé },
      { totalCents: 12_000, commissionBps: 1000, mechanicUserId: maria },
    ]);
    expect(porMecanico.get(zé), '2.160 + 13.500').toBe(15_660);
    expect(porMecanico.get(maria)).toBe(1200);
  });

  it('item sem mecânico ou sem percentual não vira comissão de ninguém', () => {
    const porMecanico = comissaoPorMecanico([
      { totalCents: 50_000, commissionBps: 1000, mechanicUserId: null },
      { totalCents: 50_000, commissionBps: null, mechanicUserId: zé },
      { totalCents: 50_000, commissionBps: 0, mechanicUserId: zé },
    ]);
    expect(porMecanico.size, 'ninguém ganhou nada aqui').toBe(0);
  });
});

describe('o percentual na tela', () => {
  it('vai e volta do jeito que a pessoa digita', () => {
    expect(formatBps(1250)).toBe('12,5%');
    expect(formatBps(1000)).toBe('10%');
    expect(parseBps('12,5')).toBe(1250);
    expect(parseBps('12.5%')).toBe(1250);
    expect(parseBps('10')).toBe(1000);
    expect(parseBps('0')).toBe(0);
  });

  it('recusa o que não é percentual', () => {
    expect(parseBps('')).toBeNull();
    expect(parseBps('abc')).toBeNull();
    expect(parseBps('-5'), 'comissão negativa não existe').toBeNull();
    expect(parseBps('120'), 'ninguém paga 120% de comissão').toBeNull();
  });
});
