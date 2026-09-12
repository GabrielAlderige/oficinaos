import type { PricingMode } from './enums/catalog';

/**
 * Preço que o serviço entra no orçamento:
 *   preço fixo → o preço;
 *   por hora técnica → valor da hora × tempo padrão (tempário).
 * `null` quando é por hora e a oficina ainda não configurou o valor da hora.
 */
export function effectiveServicePrice(
  service: { pricingMode: PricingMode; priceCents: number | null; estimatedMinutes: number | null },
  laborRateCents: number | null,
): number | null {
  if (service.pricingMode === 'FIXED') return service.priceCents;
  if (laborRateCents === null || !service.estimatedMinutes) return null;
  return Math.round((laborRateCents * service.estimatedMinutes) / 60);
}

/** 90 → "1h30"; 45 → "45 min"; 120 → "2h". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`;
}
