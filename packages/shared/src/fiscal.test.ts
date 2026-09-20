import { describe, expect, it } from 'vitest';
import {
  discriminacaoDosServicos,
  impostoPorAliquota,
  pendenciasParaEmitir,
  totaisDaNota,
  type DadosDaOficinaParaNota,
  type DadosDoTomadorParaNota,
} from './fiscal';

describe('imposto por alíquota', () => {
  it('2% de R$ 1.000,00 são R$ 20,00', () => {
    expect(impostoPorAliquota(100_000, 200)).toBe(2_000);
  });

  it('alíquota com casa decimal (2,5%) não perde centavo no meio do caminho', () => {
    expect(impostoPorAliquota(33_333, 250)).toBe(833);
  });

  it('base ou alíquota zerada não gera imposto', () => {
    expect(impostoPorAliquota(0, 500)).toBe(0);
    expect(impostoPorAliquota(50_000, 0)).toBe(0);
  });
});

describe('totais da nota', () => {
  it('o ISS sai de DENTRO do preço: o total da nota é o serviço, não serviço + ISS', () => {
    const totais = totaisDaNota({ servicosCents: 100_000, aliquotaIssBps: 500 });
    expect(totais.totalCents, 'o cliente paga o serviço').toBe(100_000);
    expect(totais.issCents).toBe(5_000);
    expect(totais.issDevidoCents, 'sem retenção, quem recolhe é a oficina').toBe(5_000);
    expect(totais.liquidoCents).toBe(100_000);
  });

  it('dedução e desconto tiram da base; só o desconto tira do total', () => {
    const totais = totaisDaNota({
      servicosCents: 100_000,
      deducoesCents: 20_000,
      descontoCents: 10_000,
      aliquotaIssBps: 500,
    });
    expect(totais.baseCalculoCents).toBe(70_000);
    expect(totais.issCents).toBe(3_500);
    expect(totais.totalCents, 'dedução é regra de imposto, não abatimento do cliente').toBe(90_000);
  });

  it('com ISS retido, a oficina não recolhe e recebe menos', () => {
    const totais = totaisDaNota({ servicosCents: 100_000, aliquotaIssBps: 500, issRetido: true });
    expect(totais.issDevidoCents).toBe(0);
    expect(totais.issRetidoCents).toBe(5_000);
    expect(totais.liquidoCents).toBe(95_000);
  });

  it('as retenções federais somam e saem do líquido', () => {
    const totais = totaisDaNota({
      servicosCents: 100_000,
      aliquotaIssBps: 500,
      irrfCents: 1_500,
      pisCents: 650,
      cofinsCents: 3_000,
      csllCents: 1_000,
    });
    expect(totais.retencoesFederaisCents).toBe(6_150);
    expect(totais.liquidoCents).toBe(93_850);
  });

  it('valor negativo não vira crédito por acidente', () => {
    const totais = totaisDaNota({ servicosCents: 10_000, descontoCents: 99_999, aliquotaIssBps: 500 });
    expect(totais.baseCalculoCents).toBe(0);
    expect(totais.totalCents).toBe(0);
    expect(totais.liquidoCents).toBe(0);
  });
});

describe('pendências para emitir', () => {
  const oficinaCompleta: DadosDaOficinaParaNota = {
    document: '12.345.678/0001-90',
    legalName: 'Oficina do Gabriel LTDA',
    municipalRegistration: '123456',
    taxRegime: 'SIMPLES_NACIONAL',
    serviceListItem: '14.01',
    issRateBps: 500,
    city: 'São Paulo',
    state: 'SP',
  };
  const tomadorCompleto: DadosDoTomadorParaNota = {
    name: 'João Pereira',
    document: '390.533.447-05',
    city: 'São Paulo',
    state: 'SP',
    zip: '01310-100',
    street: 'Avenida Paulista',
    number: '1000',
  };

  it('com tudo preenchido, não falta nada', () => {
    expect(pendenciasParaEmitir(oficinaCompleta, tomadorCompleto, 50_000)).toEqual([]);
  });

  it('cada dado que falta vira uma linha que diz ONDE resolver', () => {
    const faltando = pendenciasParaEmitir(
      { ...oficinaCompleta, municipalRegistration: '  ', issRateBps: null },
      { ...tomadorCompleto, city: null },
      50_000,
    );
    expect(faltando.map((item) => item.campo).sort()).toEqual(['address.city', 'issRateBps', 'municipalRegistration']);
    expect(faltando.find((item) => item.campo === 'address.city')!.onde).toBe('cliente');
    expect(faltando.find((item) => item.campo === 'issRateBps')!.onde).toBe('oficina');
  });

  it('OS sem serviço não emite nota de serviço', () => {
    const faltando = pendenciasParaEmitir(oficinaCompleta, tomadorCompleto, 0);
    expect(faltando).toHaveLength(1);
    expect(faltando[0]!.onde).toBe('os');
  });

  it('CPF do cliente não impede: nota para consumidor não identificado existe', () => {
    expect(pendenciasParaEmitir(oficinaCompleta, { ...tomadorCompleto, document: null }, 50_000)).toEqual([]);
  });
});

describe('discriminação dos serviços', () => {
  it('o cliente tem que reconhecer o próprio carro no texto da prefeitura', () => {
    const texto = discriminacaoDosServicos(
      { plate: 'ABC1D23', make: 'Fiat', model: 'Argo' },
      [
        { description: 'Troca de óleo', quantity: 1, totalCents: 18_000 },
        { description: 'Alinhamento', quantity: 2, totalCents: 12_000 },
      ],
      182,
    );
    expect(texto).toContain('ABC1D23');
    expect(texto).toContain('Fiat Argo');
    expect(texto).toContain('OS nº 182');
    expect(texto).toContain('- Troca de óleo');
    expect(texto, 'quantidade só aparece quando é mais de um').toContain('- 2x Alinhamento');
  });

  it('veículo sem marca e modelo não deixa parênteses vazio no texto', () => {
    const texto = discriminacaoDosServicos({ plate: 'ABC1D23', make: null, model: null }, [], 7);
    expect(texto).not.toContain('()');
  });

  it('sem placa nenhuma o texto continua legível', () => {
    const texto = discriminacaoDosServicos({ plate: null, make: 'Honda', model: 'CG 160' }, [], 7);
    expect(texto).toContain('veículo (Honda CG 160)');
    expect(texto).not.toContain('veículo  ');
  });
});
