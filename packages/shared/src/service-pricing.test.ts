import { describe, expect, it } from 'vitest';
import { effectiveServicePrice, formatDuration } from './service-pricing';

describe('preço do serviço', () => {
  it('preço fixo é o próprio preço', () => {
    expect(effectiveServicePrice({ pricingMode: 'FIXED', priceCents: 12000, estimatedMinutes: 90 }, 15000)).toBe(12000);
  });

  it('por hora = valor da hora × tempo padrão', () => {
    // R$ 150,00/h × 1h30 = R$ 225,00
    expect(effectiveServicePrice({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: 90 }, 15000)).toBe(22500);
    // R$ 133,33/h × 20 min = R$ 44,44
    expect(effectiveServicePrice({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: 20 }, 13333)).toBe(4444);
  });

  it('por hora sem valor da hora configurado fica sem preço', () => {
    expect(effectiveServicePrice({ pricingMode: 'HOURLY', priceCents: null, estimatedMinutes: 90 }, null)).toBeNull();
  });

  it('formata o tempo como a oficina fala', () => {
    expect(formatDuration(90)).toBe('1h30');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(65)).toBe('1h05');
  });
});
