/** DDDs em uso no Brasil (Anatel). DDD que não existe é erro de digitação. */
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza um telefone brasileiro para E.164 (`+5511987654321`).
 * Aceita "(11) 98765-4321", "11987654321", "+55 11 98765-4321", "011 3456-7890".
 * Devolve `null` se não for um número válido: celular tem 9 dígitos começando
 * com 9; fixo tem 8 dígitos começando de 2 a 5.
 */
export function normalizeBrazilianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  else if ((digits.length === 11 || digits.length === 12) && digits.startsWith('0')) digits = digits.slice(1);

  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!VALID_DDD.has(Number(digits.slice(0, 2)))) return null;

  const subscriber = digits.slice(2);
  const isMobile = subscriber.length === 9 && subscriber.startsWith('9');
  const isLandline = subscriber.length === 8 && /^[2-5]/.test(subscriber);
  if (!isMobile && !isLandline) return null;

  return `+55${digits}`;
}

/** `+5511987654321` → "(11) 98765-4321"; `+551134567890` → "(11) 3456-7890". */
export function formatBrazilianPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '').replace(/^55/, '');
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const split = rest.length === 9 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}
