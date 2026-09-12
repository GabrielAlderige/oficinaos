import { describe, expect, it } from 'vitest';
import {
  canonicalQuotePayload,
  effectiveQuoteStatus,
  isQuoteAnswerable,
  quoteValidUntil,
  whatsappQuoteMessage,
  type CanonicalQuote,
} from './quotes';

const base: CanonicalQuote = {
  number: 45,
  version: 1,
  validUntil: '2026-09-19T23:59:59.999Z',
  subtotalCents: 124000,
  discountCents: 4000,
  surchargeCents: 0,
  totalCents: 120000,
  items: [
    {
      position: 1,
      type: 'SERVICE',
      description: 'Troca de pastilhas',
      quantityMilli: 1000,
      unitPriceCents: 18000,
      discountCents: 0,
      totalCents: 18000,
      isOptional: false,
    },
    {
      position: 2,
      type: 'PART',
      description: 'Pastilha de freio',
      quantityMilli: 2000,
      unitPriceCents: 53000,
      discountCents: 0,
      totalCents: 106000,
      isOptional: true,
    },
  ],
};

describe('texto canônico do orçamento (base do content_hash)', () => {
  it('é estável: o mesmo conteúdo produz sempre a mesma string', () => {
    const copia = JSON.parse(JSON.stringify(base)) as CanonicalQuote;
    expect(canonicalQuotePayload(base)).toBe(canonicalQuotePayload(copia));
  });

  it('não depende da ordem em que os itens chegam', () => {
    const invertido = { ...base, items: [...base.items].reverse() };
    expect(canonicalQuotePayload(invertido)).toBe(canonicalQuotePayload(base));
  });

  it('muda se QUALQUER número do orçamento mudar', () => {
    const original = canonicalQuotePayload(base);
    expect(canonicalQuotePayload({ ...base, totalCents: 120001 })).not.toBe(original);
    expect(canonicalQuotePayload({ ...base, discountCents: 0 })).not.toBe(original);
    expect(
      canonicalQuotePayload({
        ...base,
        items: [{ ...base.items[0]!, unitPriceCents: 18001 }, base.items[1]!],
      }),
    ).not.toBe(original);
  });

  it('muda se um item deixar de ser recomendado (o cliente aprovou outra coisa)', () => {
    const items = [base.items[0]!, { ...base.items[1]!, isOptional: false }];
    expect(canonicalQuotePayload({ ...base, items })).not.toBe(canonicalQuotePayload(base));
  });

  it('ignora espaço sobrando na descrição, que não muda o que o cliente vê', () => {
    const items = [{ ...base.items[0]!, description: '  Troca de pastilhas  ' }, base.items[1]!];
    expect(canonicalQuotePayload({ ...base, items })).toBe(canonicalQuotePayload(base));
  });
});

describe('validade', () => {
  const validUntil = '2026-09-19T23:59:59.999Z';

  it('aceita resposta enquanto está enviado e dentro do prazo', () => {
    expect(isQuoteAnswerable('SENT', validUntil, new Date('2026-09-15T10:00:00Z'))).toBe(true);
    expect(isQuoteAnswerable('SENT', validUntil, new Date('2026-09-20T10:00:00Z'))).toBe(false);
    expect(isQuoteAnswerable('APPROVED', validUntil, new Date('2026-09-15T10:00:00Z'))).toBe(false);
    expect(isQuoteAnswerable('REVOKED', validUntil, new Date('2026-09-15T10:00:00Z'))).toBe(false);
  });

  it('enviado e vencido aparece como expirado, sem depender de rotina', () => {
    expect(effectiveQuoteStatus('SENT', validUntil, new Date('2026-09-20T00:00:00Z'))).toBe('EXPIRED');
    expect(effectiveQuoteStatus('SENT', validUntil, new Date('2026-09-18T00:00:00Z'))).toBe('SENT');
    // decidido não muda: aprovado continua aprovado depois do prazo
    expect(effectiveQuoteStatus('APPROVED', validUntil, new Date('2026-09-30T00:00:00Z'))).toBe('APPROVED');
  });

  it('a validade vale o dia inteiro', () => {
    const until = quoteValidUntil(new Date('2026-09-12T08:00:00'), 7);
    expect(until.getDate()).toBe(19);
    expect(until.getHours()).toBe(23);
  });
});

describe('mensagem do WhatsApp', () => {
  it('usa o primeiro nome, a placa e o total, com o link por último', () => {
    const message = whatsappQuoteMessage({
      customerName: 'João Pereira da Silva',
      shopName: 'Auto Center Silva',
      vehicle: { make: 'Volkswagen', model: 'Gol', plate: 'ABC1C34' },
      totalCents: 120000,
      link: 'https://app.oficinaos.com.br/orcamento/abc123',
    });
    expect(message).toContain('Olá, João!');
    expect(message).toContain('Auto Center Silva');
    // placa Mercosul sai sem separador; o hífen é só da placa antiga (formatPlate)
    expect(message).toContain('Volkswagen Gol (ABC1C34)');
    // o espaco do Intl vai como ESCAPE: o caractere literal vira espaco comum na escrita
    expect(message.replace(/\u00a0/g, " ")).toContain("R$ 1.200,00");
    expect(message.endsWith('https://app.oficinaos.com.br/orcamento/abc123')).toBe(true);
  });

  it('carro sem placa não deixa parêntese vazio', () => {
    const message = whatsappQuoteMessage({
      customerName: 'Maria',
      shopName: 'Oficina',
      vehicle: { make: 'Fiat', model: 'Uno', plate: null },
      totalCents: 5000,
      link: 'https://x/y',
    });
    expect(message).toContain('Fiat Uno:');
    expect(message).not.toContain('()');
  });
});
