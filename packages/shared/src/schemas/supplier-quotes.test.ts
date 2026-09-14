import { describe, expect, it } from 'vitest';
import { createSupplierQuoteSchema, publicSupplierResponseSchema } from './supplier-quotes';

const ITEM = '01a09c30-ca23-758e-8590-30c069903c7b';
const OUTRO = '01a09c30-ca23-758e-8590-30c069903c7c';
const HASH = 'a'.repeat(64);

const resposta = (items: Record<string, unknown>[]) => ({ contentHash: HASH, responderName: 'Roberto', items });

/** A mensagem, e não só o "falhou": teste que só olha o status mente sobre o que cobre (lição da E6). */
const mensagens = (valor: unknown) => {
  const r = publicSupplierResponseSchema.safeParse(valor);
  return r.success ? [] : r.error.issues.map((issue) => issue.message);
};

describe('resposta do fornecedor', () => {
  it('quem tem a peça precisa dizer o preço', () => {
    expect(mensagens(resposta([{ requestItemId: ITEM, availability: 'AVAILABLE', unitPriceCents: null }]))).toContain(
      'Informe o preço',
    );
    expect(mensagens(resposta([{ requestItemId: ITEM, availability: 'TO_ORDER', unitPriceCents: null }]))).toContain(
      'Informe o preço',
    );
  });

  it('quem não tem a peça não informa preço: seria oferta fantasma no quadro', () => {
    expect(mensagens(resposta([{ requestItemId: ITEM, availability: 'UNAVAILABLE', unitPriceCents: 5000 }]))).toContain(
      'Quem não tem a peça não informa preço',
    );
    expect(mensagens(resposta([{ requestItemId: ITEM, availability: 'UNAVAILABLE', unitPriceCents: null }]))).toEqual([]);
  });

  it('preço zero não é oferta', () => {
    expect(mensagens(resposta([{ requestItemId: ITEM, availability: 'AVAILABLE', unitPriceCents: 0 }]))).toContain(
      'Preço precisa ser maior que zero',
    );
  });

  it('a mesma peça não é respondida duas vezes na mesma resposta', () => {
    const duplicada = resposta([
      { requestItemId: ITEM, availability: 'AVAILABLE', unitPriceCents: 100 },
      { requestItemId: ITEM, availability: 'AVAILABLE', unitPriceCents: 90 },
    ]);
    expect(mensagens(duplicada)).toContain('Peça respondida duas vezes');
  });

  it('exige o nome de quem respondeu e a versão que ele viu', () => {
    const semNome = { ...resposta([{ requestItemId: ITEM, availability: 'UNAVAILABLE', unitPriceCents: null }]), responderName: ' ' };
    expect(mensagens(semNome)).toContain('Informe o seu nome');
    const semHash = { ...resposta([{ requestItemId: ITEM, availability: 'UNAVAILABLE', unitPriceCents: null }]), contentHash: 'x' };
    expect(mensagens(semHash)).toContain('Versão inválida');
  });
});

describe('criar a cotação', () => {
  const base = { workOrderId: ITEM, workOrderItemIds: [ITEM], supplierIds: [ITEM] };

  it('vem com chassi desligado e 48 h de validade', () => {
    const saida = createSupplierQuoteSchema.parse(base);
    expect(saida.includeVin).toBe(false);
    expect(saida.expiresInHours).toBe(48);
  });

  it('recusa fornecedor repetido e peça repetida', () => {
    const r1 = createSupplierQuoteSchema.safeParse({ ...base, supplierIds: [ITEM, ITEM] });
    expect(r1.success ? [] : r1.error.issues.map((i) => i.message)).toContain('Fornecedor repetido');
    const r2 = createSupplierQuoteSchema.safeParse({ ...base, workOrderItemIds: [OUTRO, OUTRO] });
    expect(r2.success ? [] : r2.error.issues.map((i) => i.message)).toContain('Peça repetida');
  });
});
