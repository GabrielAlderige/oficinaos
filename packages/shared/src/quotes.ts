/**
 * Regras puras do orçamento (docs/ARCHITECTURE.md §8.1). O que mora aqui é
 * usado pela API e pela página pública sem depender de banco nem de rede.
 */

import { formatBRL } from './money';
import { formatPlate } from './br/plate';
import type { QuoteStatus } from './enums/quotes';

export interface CanonicalQuoteItem {
  position: number;
  type: string;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  isOptional: boolean;
}

export interface CanonicalQuote {
  number: number;
  version: number;
  validUntil: string;
  subtotalCents: number;
  discountCents: number;
  surchargeCents: number;
  totalCents: number;
  items: CanonicalQuoteItem[];
}

/**
 * Texto canônico do orçamento: a base do `content_hash`.
 *
 * É gravado no envio e conferido na aprovação. Se qualquer número mudar entre
 * o que o cliente viu e o que está no servidor, o hash muda e a aprovação é
 * recusada com 409 — ninguém aprova um valor e recebe outro. Por isso a ordem
 * dos campos é FIXA e os itens vão ordenados por posição: duas execuções com o
 * mesmo conteúdo têm que produzir exatamente a mesma string.
 *
 * O hash em si fica no servidor (`node:crypto`); a página pública só devolve o
 * que recebeu, para não carregar biblioteca de hash no pacote do cliente.
 */
export function canonicalQuotePayload(quote: CanonicalQuote): string {
  const head = [
    `number:${quote.number}`,
    `version:${quote.version}`,
    `validUntil:${quote.validUntil}`,
    `subtotal:${quote.subtotalCents}`,
    `discount:${quote.discountCents}`,
    `surcharge:${quote.surchargeCents}`,
    `total:${quote.totalCents}`,
  ].join('|');

  const items = [...quote.items]
    .sort((a, b) => a.position - b.position)
    .map((item) =>
      [
        item.position,
        item.type,
        item.description.trim(),
        item.quantityMilli,
        item.unitPriceCents,
        item.discountCents,
        item.totalCents,
        item.isOptional ? 'opcional' : 'necessario',
      ].join('|'),
    );

  return [head, ...items].join('\n');
}

/** O link ainda aceita resposta? (expirado é decidido pela data, não por job) */
export function isQuoteAnswerable(status: QuoteStatus, validUntil: string, now: Date = new Date()): boolean {
  return status === 'SENT' && Date.parse(validUntil) > now.getTime();
}

/** Situação que o cliente vê: `SENT` vencido aparece como expirado. */
export function effectiveQuoteStatus(status: QuoteStatus, validUntil: string, now: Date = new Date()): QuoteStatus {
  return status === 'SENT' && Date.parse(validUntil) <= now.getTime() ? 'EXPIRED' : status;
}

export function quoteValidUntil(from: Date, days: number): Date {
  const until = new Date(from);
  until.setDate(until.getDate() + days);
  until.setHours(23, 59, 59, 999); // vale o dia inteiro: "vence sexta" é sexta até o fim
  return until;
}

/**
 * Mensagem pronta do WhatsApp (a oficina revisa antes de enviar). Curta de
 * propósito: mensagem grande no celular esconde o link.
 */
export function whatsappQuoteMessage(input: {
  customerName: string;
  shopName: string;
  vehicle: { make: string; model: string; plate: string | null };
  totalCents: number;
  link: string;
}): string {
  const firstName = input.customerName.trim().split(/\s+/)[0] ?? input.customerName;
  const plate = input.vehicle.plate ? ` (${formatPlate(input.vehicle.plate)})` : '';
  return [
    `Olá, ${firstName}! Aqui é da ${input.shopName}.`,
    `Preparamos o orçamento do seu ${input.vehicle.make} ${input.vehicle.model}${plate}: ${formatBRL(input.totalCents)}.`,
    'Você pode ver os itens e aprovar por aqui:',
    input.link,
  ].join('\n\n');
}
