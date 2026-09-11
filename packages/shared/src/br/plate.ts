/**
 * Placas brasileiras. Existem dois formatos em circulação:
 *   antigo    ABC1234  (3 letras + 4 números)
 *   Mercosul  ABC1D23  (3 letras + número + LETRA + 2 números)
 * Na conversão para Mercosul, o 2º número (5ª posição) vira letra: 0→A, 1→B, … 9→J.
 * O mesmo carro pode aparecer com as duas placas, então guardamos também a forma
 * CANÔNICA (sempre Mercosul) para busca e unicidade (docs/DATABASE.md §1.1).
 */

const OLD_FORMAT = /^[A-Z]{3}\d{4}$/;
const MERCOSUL_FORMAT = /^[A-Z]{3}\d[A-Z]\d{2}$/;
const DIGIT_TO_LETTER = 'ABCDEFGHIJ';

/** "abc-1234" → "ABC1234": só letras e números, em maiúsculas. */
export function normalizePlate(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidPlate(input: string): boolean {
  const plate = normalizePlate(input);
  return OLD_FORMAT.test(plate) || MERCOSUL_FORMAT.test(plate);
}

export function isMercosulPlate(input: string): boolean {
  return MERCOSUL_FORMAT.test(normalizePlate(input));
}

function convertFifth(plate: string): string {
  const fifth = plate[4];
  return fifth !== undefined && /\d/.test(fifth)
    ? plate.slice(0, 4) + DIGIT_TO_LETTER[Number(fifth)] + plate.slice(5)
    : plate;
}

/** Forma canônica (Mercosul): ABC1234 → ABC1C34. `null` se não for placa válida. */
export function canonicalPlate(input: string): string | null {
  const plate = normalizePlate(input);
  if (MERCOSUL_FORMAT.test(plate)) return plate;
  if (OLD_FORMAT.test(plate)) return convertFifth(plate);
  return null;
}

// posição a posição: letra, letra, letra, número, letra-ou-número, número, número
const POSITIONS = [/[A-Z]/, /[A-Z]/, /[A-Z]/, /\d/, /[A-Z0-9]/, /\d/, /\d/];

/**
 * Prefixo canônico enquanto a pessoa digita: "abc12" → "ABC1C", "ABC1" → "ABC1".
 * `null` se o texto não pode ser começo de placa (ex.: "JOAO").
 */
export function canonicalPlatePrefix(input: string): string | null {
  const plate = normalizePlate(input);
  if (plate.length < 2 || plate.length > 7) return null;
  for (let i = 0; i < plate.length; i++) {
    if (!POSITIONS[i]!.test(plate[i]!)) return null;
  }
  return convertFifth(plate);
}

/** Exibição: antiga com hífen (ABC-1234), Mercosul sem (ABC1D23). */
export function formatPlate(input: string): string {
  const plate = normalizePlate(input);
  return OLD_FORMAT.test(plate) ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}
