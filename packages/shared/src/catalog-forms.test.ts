import { describe, expect, it } from 'vitest';
import {
  partApplicationFormSchema,
  partFormSchema,
  pricingSettingsFormSchema,
  serviceFormSchema,
  stockAdjustmentFormSchema,
  stockEntryFormSchema,
} from './schemas/catalog';

const service = {
  name: 'Troca de embreagem',
  category: '',
  description: '',
  pricingMode: 'FIXED' as const,
  price: '',
  estimatedHours: '',
  intervalKm: '',
  intervalMonths: '',
  isActive: true,
};

const part = {
  name: 'Óleo 5W30',
  sku: '',
  manufacturerCode: '',
  manufacturer: '',
  categoryId: '',
  description: '',
  unit: 'L' as const,
  ean: '',
  salePrice: '',
  markup: '',
  minQuantity: '',
  location: '',
  preferredSupplierId: '',
  trackStock: true,
  isActive: true,
  initialQuantity: '',
  initialUnitCost: '',
};

describe('formulários do catálogo (texto digitado → formato da API)', () => {
  it('serviço: "1,5" hora vira 90 minutos; por hora não grava preço fixo', () => {
    const out = serviceFormSchema.parse({ ...service, pricingMode: 'HOURLY', price: '99,00', estimatedHours: '1,5', intervalKm: '10.000' });
    expect(out).toMatchObject({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: 90, intervalKm: 10000 });
  });

  it('serviço: preço fixo sem preço aponta o campo "price"', () => {
    const result = serviceFormSchema.safeParse(service);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['price']);
  });

  it('peça: dinheiro, margem e quantidades', () => {
    const out = partFormSchema.parse({ ...part, salePrice: '1.234,56', markup: '12,5', minQuantity: '2,5', initialQuantity: '4,5', initialUnitCost: '42,00' });
    expect(out).toMatchObject({
      categoryId: null,
      // "Nenhum" no seletor vira null, não um id vazio que o banco recusaria
      preferredSupplierId: null,
      salePriceCents: 123456,
      markupBps: 1250,
      minQuantity: 2.5,
      initialQuantity: 4.5,
      initialUnitCostCents: 4200,
    });
  });

  it('peça: o fornecedor escolhido no seletor chega como id', () => {
    const id = '01a09c30-ca23-758e-8590-30c069903c7b';
    expect(partFormSchema.parse({ ...part, preferredSupplierId: id }).preferredSupplierId).toBe(id);
  });

  it('peça: "12.5" como preço é ambíguo e é recusado', () => {
    expect(partFormSchema.safeParse({ ...part, salePrice: '12.5' }).success).toBe(false);
  });

  it('entrada: quantidade obrigatória e maior que zero; custo opcional', () => {
    expect(stockEntryFormSchema.parse({ quantity: '4,5', unitCost: '', reason: '' })).toEqual({
      type: 'ENTRY',
      quantity: 4.5,
      unitCostCents: null,
      reason: '',
    });
    expect(stockEntryFormSchema.safeParse({ quantity: '0', unitCost: '', reason: '' }).success).toBe(false);
    expect(stockEntryFormSchema.safeParse({ quantity: '', unitCost: '', reason: '' }).success).toBe(false);
  });

  it('ajuste: contagem pode ser zero, motivo é obrigatório', () => {
    expect(stockAdjustmentFormSchema.parse({ countedQuantity: '0', reason: 'Peça danificada' })).toEqual({
      type: 'ADJUSTMENT',
      countedQuantity: 0,
      reason: 'Peça danificada',
    });
    expect(stockAdjustmentFormSchema.safeParse({ countedQuantity: '3', reason: 'ok' }).success).toBe(false);
  });

  it('aplicação: anos opcionais, final não vem antes do inicial', () => {
    const base = { make: 'Volkswagen', model: 'Gol', engine: '', notes: '' };
    expect(partApplicationFormSchema.parse({ ...base, yearFrom: '2008', yearTo: '' })).toMatchObject({ yearFrom: 2008, yearTo: null });
    const bad = partApplicationFormSchema.safeParse({ ...base, yearFrom: '2016', yearTo: '2008' });
    expect(bad.error?.issues[0]?.path).toEqual(['yearTo']);
  });

  it('configurações: hora técnica opcional, margem obrigatória até 1000%', () => {
    expect(pricingSettingsFormSchema.parse({ laborRate: '', defaultMarkup: '30' })).toEqual({ laborRateCents: null, defaultMarkupBps: 3000 });
    expect(pricingSettingsFormSchema.parse({ laborRate: '150,00', defaultMarkup: '12,5' })).toEqual({ laborRateCents: 15000, defaultMarkupBps: 1250 });
    expect(pricingSettingsFormSchema.safeParse({ laborRate: '', defaultMarkup: '' }).success).toBe(false);
    expect(pricingSettingsFormSchema.safeParse({ laborRate: '', defaultMarkup: '1001' }).success).toBe(false);
  });
});
