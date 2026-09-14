import { describe, expect, it } from 'vitest';
import { supplierTextFormSchema } from './suppliers';

const base = {
  name: 'Autopeças Central',
  legalName: '',
  document: '',
  contactName: '',
  phone: '',
  whatsapp: '',
  email: '',
  address: { zip: '', street: '', number: '', complement: '', district: '', city: '', state: '' },
  categories: [],
  leadTimeDays: '',
  rating: '',
  notes: '',
} as const;

describe('formulário de fornecedor', () => {
  it('campo vazio de prazo e nota vira "não informado", não zero', () => {
    const saida = supplierTextFormSchema.parse(base);
    expect(saida.leadTimeDays).toBeNull();
    expect(saida.rating).toBeNull();
  });

  it('prazo e nota digitados viram número', () => {
    const saida = supplierTextFormSchema.parse({ ...base, leadTimeDays: ' 3 ', rating: '4' });
    expect(saida.leadTimeDays).toBe(3);
    expect(saida.rating).toBe(4);
  });

  it('recusa prazo fora de 0 a 365 e texto no lugar de número', () => {
    expect(supplierTextFormSchema.safeParse({ ...base, leadTimeDays: '400' }).success).toBe(false);
    expect(supplierTextFormSchema.safeParse({ ...base, leadTimeDays: 'dois' }).success).toBe(false);
    expect(supplierTextFormSchema.safeParse({ ...base, rating: '6' }).success).toBe(false);
  });

  it('categoria repetida ou com espaço sobrando entra uma vez só', () => {
    const saida = supplierTextFormSchema.parse({ ...base, categories: ['Freios', ' Freios ', 'Suspensão'] });
    expect(saida.categories).toEqual(['Freios', 'Suspensão']);
  });
});
