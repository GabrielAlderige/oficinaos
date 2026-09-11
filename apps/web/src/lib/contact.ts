import { formatBrazilianPhone, formatDocument } from '@oficinaos/shared';

/** Telefone para exibir: formata E.164; valor mascarado (mecânico) passa como veio. */
export function displayPhone(value: string | null): string | null {
  if (!value) return null;
  return value.startsWith('+') ? formatBrazilianPhone(value) : value;
}

export function displayDocument(value: string | null): string | null {
  if (!value) return null;
  return /^[0-9A-Z]+$/.test(value) ? formatDocument(value) : value;
}

/** Link do WhatsApp (wa.me). null para número mascarado ou ausente. */
export function whatsappUrl(e164: string | null, text?: string): string | null {
  if (!e164?.startsWith('+')) return null;
  const url = `https://wa.me/${e164.replace(/\D/g, '')}`;
  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

const kmFormat = new Intl.NumberFormat('pt-BR');
export const formatKm = (km: number) => `${kmFormat.format(km)} km`;

/** Marcas mais comuns nas oficinas brasileiras (sugestão no campo; qualquer texto vale). */
export const COMMON_MAKES = [
  'Chevrolet', 'Volkswagen', 'Fiat', 'Ford', 'Toyota', 'Hyundai', 'Renault', 'Honda', 'Jeep',
  'Nissan', 'Peugeot', 'Citroën', 'Mitsubishi', 'Kia', 'BYD', 'Caoa Chery', 'Mercedes-Benz',
  'BMW', 'Audi', 'Volvo', 'Ram', 'Suzuki', 'Land Rover', 'Yamaha', 'Honda Motos',
];
