import { describe, expect, it } from 'vitest';
import { formaDePagamentoDaNota, icmsSituacaoDaNota, pendenciasDaNotaDePecas, ratearDesconto } from './product-invoices';

const base = {
  modelo: 'NFCE' as const,
  cnpjOficina: '11.222.333/0001-81',
  inscricaoEstadual: '123456789',
  icmsSituacao: '102',
  itens: [{ nome: 'Filtro de óleo', ncm: '8421.23.00' }],
  cliente: null,
};

describe('nota de peças (E50)', () => {
  it('rateia o desconto sem perder centavo', () => {
    const partes = ratearDesconto([1_000, 2_000, 333], 100);
    expect(partes.reduce((s, v) => s + v, 0)).toBe(100);
    expect(partes[1]).toBeGreaterThan(partes[0]!);
    expect(ratearDesconto([500], 900)).toEqual([500]);
    expect(ratearDesconto([500, 500], 0)).toEqual([0, 0]);
  });

  it('no Simples e no MEI o ICMS sai como CSOSN 102; fora dele, só o que o contador informar', () => {
    expect(icmsSituacaoDaNota('SIMPLES_NACIONAL', null)).toBe('102');
    expect(icmsSituacaoDaNota('MEI', null)).toBe('102');
    expect(icmsSituacaoDaNota('LUCRO_PRESUMIDO', null)).toBeNull();
    expect(icmsSituacaoDaNota('LUCRO_PRESUMIDO', '00')).toBe('00');
  });

  it('forma de pagamento na tabela da SEFAZ (Pix é 17, fiado é crédito loja)', () => {
    expect(formaDePagamentoDaNota('PIX')).toBe('17');
    expect(formaDePagamentoDaNota('CASH')).toBe('01');
    expect(formaDePagamentoDaNota('LATER')).toBe('05');
    expect(formaDePagamentoDaNota(null)).toBe('99');
  });

  it('tudo certo: nenhuma pendência na NFC-e', () => {
    expect(pendenciasDaNotaDePecas(base)).toEqual([]);
  });

  it('peça sem NCM, oficina sem IE e sem situação do ICMS: cada um diz onde resolver', () => {
    const p = pendenciasDaNotaDePecas({ ...base, inscricaoEstadual: '', icmsSituacao: null, itens: [{ nome: 'Lâmpada', ncm: null }] });
    expect(p.map((x) => x.campo).sort()).toEqual(['icms', 'ie', 'ncm']);
    expect(p.find((x) => x.campo === 'ncm')!.mensagem).toContain('Lâmpada');
  });

  it('a NF-e exige cliente com documento e endereço completo', () => {
    const semEndereco = pendenciasDaNotaDePecas({ ...base, modelo: 'NFE', cliente: { documento: '11222333000181', endereco: { street: 'Rua A' } } });
    expect(semEndereco.map((x) => x.campo)).toEqual(['endereco']);
    const semCliente = pendenciasDaNotaDePecas({ ...base, modelo: 'NFE', cliente: null });
    expect(semCliente.map((x) => x.campo).sort()).toEqual(['cliente', 'endereco']);
  });
});
