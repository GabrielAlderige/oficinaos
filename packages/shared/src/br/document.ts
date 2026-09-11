/**
 * CPF e CNPJ. Guardados sem pontuação (docs/DATABASE.md §1).
 *
 * Desde julho de 2026 a Receita emite CNPJ **alfanumérico**: as 12 primeiras
 * posições podem ter letras (A–Z) e os 2 dígitos verificadores continuam
 * numéricos. O cálculo é o mesmo módulo 11, usando o valor de cada caractere
 * como `código ASCII − 48` (então '0'–'9' valem 0–9 e 'A' vale 17). O CNPJ
 * numérico antigo continua válido pelo mesmo algoritmo.
 */

export function normalizeCpf(input: string): string {
  return input.replace(/\D/g, '');
}

export function normalizeCnpj(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function isValidCpf(input: string): boolean {
  const cpf = normalizeCpf(input);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const digit = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(cpf[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

const CNPJ_WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function cnpjDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i]!;
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(input: string): boolean {
  const cnpj = normalizeCnpj(input);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const base = cnpj.slice(0, 12);
  const first = cnpjDigit(base, CNPJ_WEIGHTS_1);
  const second = cnpjDigit(base + first, CNPJ_WEIGHTS_2);
  return cnpj.endsWith(`${first}${second}`);
}

/** Normaliza CPF ou CNPJ; `null` se não for nenhum dos dois válido. */
export function normalizeDocument(input: string): string | null {
  if (isValidCpf(input)) return normalizeCpf(input);
  if (isValidCnpj(input)) return normalizeCnpj(input);
  return null;
}

export function formatDocument(value: string): string {
  if (/^\d{11}$/.test(value)) return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (/^[0-9A-Z]{14}$/.test(value)) {
    return value.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  }
  return value;
}
