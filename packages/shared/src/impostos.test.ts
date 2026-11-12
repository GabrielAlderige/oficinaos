import { describe, expect, it } from 'vitest';
import { ANEXO_I, ANEXO_III, aliquotaEfetivaSimples, impostosSobreFaturamento, irpjCsllLucroReal, type EntradaImpostos } from './impostos';

const base: EntradaImpostos = {
  regime: 'SIMPLES_NACIONAL',
  servicosCents: 10_000_000, // R$ 100 mil de serviço
  pecasCents: 0,
  rbt12Cents: 30_000_000, // R$ 300 mil nos 12 meses anteriores
  issBps: 500,
  icmsBps: null,
  pecasComIcmsSt: true,
  custoPecasCents: 0,
  dasMeiCents: null,
  fracaoDoMes: 1,
};

/** Os números esperados foram feitos à mão, com a tabela da LC 155/2016 aberta do lado. */
describe('impostos da DRE (E51)', () => {
  describe('Simples Nacional', () => {
    it('alíquota efetiva = (RBT12 × nominal − parcela a deduzir) ÷ RBT12', () => {
      // Anexo III, 2ª faixa: (300.000 × 11,2% − 9.360) ÷ 300.000 = 8,08%
      expect(aliquotaEfetivaSimples(ANEXO_III, 30_000_000)).toBeCloseTo(8.08, 6);
      // Anexo I, 2ª faixa: (300.000 × 7,3% − 5.940) ÷ 300.000 = 5,32%
      expect(aliquotaEfetivaSimples(ANEXO_I, 30_000_000)).toBeCloseTo(5.32, 6);
      // primeiro mês, sem receita anterior: a nominal da 1ª faixa
      expect(aliquotaEfetivaSimples(ANEXO_III, 0)).toBe(6);
    });

    it('serviço no Anexo III: o DAS de 8,08% repartido pela tabela da 2ª faixa', () => {
      const { impostos, simples } = impostosSobreFaturamento(base);
      expect(impostos.iss).toBe(258_560); // 32% de R$ 8.080
      expect(impostos.cpp).toBe(350_672); // 43,4%
      expect(impostos.irpj).toBe(32_320); // 4%
      expect(impostos.csll).toBe(28_280); // 3,5%
      expect(impostos.cofins).toBe(113_524); // 14,05%
      expect(impostos.pis).toBe(24_644); // 3,05%
      const das = impostos.iss + impostos.cpp + impostos.irpj + impostos.csll + impostos.cofins + impostos.pis;
      expect(das).toBe(808_000);
      expect(simples).toEqual([{ anexo: 'III', faixa: 2, efetivaBps: 808 }]);
    });

    it('peça no Anexo I; com ICMS-ST a parcela do ICMS sai do DAS', () => {
      const comSt = impostosSobreFaturamento({ ...base, servicosCents: 0, pecasCents: 5_000_000 });
      const semSt = impostosSobreFaturamento({ ...base, servicosCents: 0, pecasCents: 5_000_000, pecasComIcmsSt: false });
      expect(semSt.impostos.icms).toBe(90_440); // 34% de R$ 2.660
      expect(comSt.impostos.icms).toBe(0);
      const totalSem = Object.values(semSt.impostos).reduce((s, v) => s + v, 0);
      const totalCom = Object.values(comSt.impostos).reduce((s, v) => s + v, 0);
      expect(totalSem).toBe(266_000); // 5,32% de R$ 50 mil
      expect(totalCom).toBe(266_000 - 90_440);
    });

    it('5ª faixa do Anexo III: o ISS dentro do DAS para em 5% e o resto vai para os outros tributos', () => {
      // RBT12 de R$ 3 milhões: efetiva 16,812%; 33,5% dela daria ISS de 5,63%
      const { impostos } = impostosSobreFaturamento({ ...base, rbt12Cents: 300_000_000 });
      expect(impostos.iss).toBe(500_000); // 5% de R$ 100 mil, nem um centavo a mais
      const das = impostos.iss + impostos.cpp + impostos.irpj + impostos.csll + impostos.cofins + impostos.pis;
      expect(Math.abs(das - 1_681_200)).toBeLessThanOrEqual(3); // o total do DAS não muda (arredondamento por tributo)
    });
  });

  it('Lucro Presumido: PIS 0,65%, COFINS 3%, ISS do município e IRPJ/CSLL sobre a presunção', () => {
    const { impostos } = impostosSobreFaturamento({ ...base, regime: 'LUCRO_PRESUMIDO', pecasCents: 5_000_000 });
    expect(impostos.pis).toBe(97_500);
    expect(impostos.cofins).toBe(450_000);
    expect(impostos.iss).toBe(500_000);
    expect(impostos.icms, 'peça com ICMS-ST não paga de novo').toBe(0);
    // base IRPJ: 32% de 100 mil + 8% de 50 mil = 36 mil → 15% + 10% do que passa de 20 mil
    expect(impostos.irpj).toBe(700_000);
    // base CSLL: 32% de 100 mil + 12% de 50 mil = 38 mil → 9%
    expect(impostos.csll).toBe(342_000);
    expect(impostos.cpp).toBe(0);
  });

  it('Lucro Presumido sem ICMS-ST: a peça paga a alíquota informada', () => {
    const { impostos } = impostosSobreFaturamento({
      ...base,
      regime: 'LUCRO_PRESUMIDO',
      pecasCents: 5_000_000,
      pecasComIcmsSt: false,
      icmsBps: 1800,
    });
    expect(impostos.icms).toBe(900_000);
  });

  it('Lucro Real: PIS e COFINS não cumulativos com crédito do custo da peça; IRPJ e CSLL sobre o lucro', () => {
    const { impostos } = impostosSobreFaturamento({
      ...base,
      regime: 'LUCRO_REAL',
      pecasCents: 5_000_000,
      custoPecasCents: 3_000_000,
    });
    expect(impostos.pis).toBe(198_000); // 1,65% de 150 mil − 1,65% de 30 mil
    expect(impostos.cofins).toBe(912_000); // 7,6% de 150 mil − 7,6% de 30 mil
    expect(impostos.irpj, 'no Real o IRPJ não sai do faturamento').toBe(0);
    expect(irpjCsllLucroReal(5_000_000, 1)).toEqual({ irpj: 1_050_000, csll: 450_000 });
    expect(irpjCsllLucroReal(-100_000, 1), 'prejuízo não paga').toEqual({ irpj: 0, csll: 0 });
  });

  it('o limite do adicional do IRPJ é proporcional quando o período é parte do mês', () => {
    // meio mês: limite de R$ 10 mil. Base 36 mil → 15% (5.400) + 10% de 26 mil (2.600)
    const { impostos } = impostosSobreFaturamento({ ...base, regime: 'LUCRO_PRESUMIDO', pecasCents: 5_000_000, fracaoDoMes: 0.5 });
    expect(impostos.irpj).toBe(800_000);
  });

  it('MEI paga o DAS fixo; sem regime, nada é inventado e a tela é avisada', () => {
    expect(impostosSobreFaturamento({ ...base, regime: 'MEI', dasMeiCents: 8_160 }).impostos.dasMei).toBe(8_160);
    const semRegime = impostosSobreFaturamento({ ...base, regime: null });
    expect(Object.values(semRegime.impostos).every((v) => v === 0)).toBe(true);
    expect(semRegime.avisos[0]).toMatch(/regime/);
  });

  it('sem alíquota de ISS no Presumido: avisa em vez de chutar', () => {
    const r = impostosSobreFaturamento({ ...base, regime: 'LUCRO_PRESUMIDO', issBps: null });
    expect(r.impostos.iss).toBe(0);
    expect(r.avisos.join(' ')).toMatch(/ISS/);
  });
});
