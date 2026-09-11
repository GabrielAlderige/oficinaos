import { normalizeBrazilianPhone, normalizeDocument } from '@oficinaos/shared';
import type { Address } from '../db/schema';

/**
 * Formulários mandam "" para campo em branco. Na gravação: ausente não mexe,
 * vazio vira null, preenchido sai normalizado.
 */
export const blankToNull = (value: string | undefined): string | null | undefined =>
  value === undefined ? undefined : value.trim() === '' ? null : value.trim();

export const phoneOrNull = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() === '' ? null : normalizeBrazilianPhone(value);

export const documentOrNull = (value: string | undefined) =>
  value === undefined ? undefined : value.trim() === '' ? null : normalizeDocument(value);

export const emailOrNull = (value: string | undefined) => {
  const email = blankToNull(value);
  return email ? email.toLowerCase() : email;
};

export interface AddressInput {
  zip: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
}

/** CEP só com dígitos; endereço todo em branco vira null. */
export function normalizeAddress(address: AddressInput): Address | null {
  const clean: AddressInput = {
    zip: address.zip.replace(/\D/g, ''),
    street: address.street.trim(),
    number: address.number.trim(),
    complement: address.complement.trim(),
    district: address.district.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
  };
  return Object.values(clean).every((v) => v === '') ? null : clean;
}

/** Na saída o endereço tem sempre os 7 campos (vazio = "") para o formulário. */
export function addressDto(address: Address | null | undefined): AddressInput {
  return {
    zip: address?.zip ?? '',
    street: address?.street ?? '',
    number: address?.number ?? '',
    complement: address?.complement ?? '',
    district: address?.district ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
  };
}

export const isoOrNull = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/** Padrão de LIKE com o texto da pessoa escapado (% e _ viram literais). */
export const likeContains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const kmFormat = new Intl.NumberFormat('pt-BR');
export const formatKm = (km: number) => `${kmFormat.format(km)} km`;
