import { describe, expect, it } from 'vitest';
import { cobrancaAberta, disponivelParaCobrar, metodoDoCaixa, vencimentoPadrao, whatsappChargeMessage } from './charges';

describe('cobrança online', () => {
  it('cada forma de cobrança entra no caixa com o nome certo', () => {
    expect(metodoDoCaixa('PIX')).toBe('PIX');
    expect(metodoDoCaixa('BOLETO')).toBe('BOLETO');
    expect(metodoDoCaixa('CREDIT_CARD')).toBe('CREDIT_CARD');
    // no link o cliente escolhe: só o aviso do gateway dirá o que foi
    expect(metodoDoCaixa('LINK')).toBe('OTHER');
  });

  it('só a cobrança pendente ainda espera dinheiro', () => {
    expect(cobrancaAberta('PENDING')).toBe(true);
    for (const status of ['PAID', 'CANCELED', 'EXPIRED', 'REFUNDED', 'FAILED'] as const) {
      expect(cobrancaAberta(status), status).toBe(false);
    }
  });

  it('boleto vence depois: ele leva um dia útil para chegar ao banco do cliente', () => {
    expect(vencimentoPadrao('2026-09-20', 'PIX')).toBe('2026-09-23');
    expect(vencimentoPadrao('2026-09-20', 'BOLETO')).toBe('2026-09-27');
    // vira o mês sem inventar dia 31
    expect(vencimentoPadrao('2026-09-29', 'BOLETO')).toBe('2026-10-06');
  });

  it('o que já está pendurado em cobrança aberta não pode ser cobrado de novo', () => {
    expect(disponivelParaCobrar({ saldoCents: 50_000, emAbertoCents: 0 })).toBe(50_000);
    expect(disponivelParaCobrar({ saldoCents: 50_000, emAbertoCents: 20_000 })).toBe(30_000);
    // dois Pix do valor inteiro terminariam com o cliente pagando duas vezes
    expect(disponivelParaCobrar({ saldoCents: 50_000, emAbertoCents: 50_000 })).toBe(0);
    expect(disponivelParaCobrar({ saldoCents: 50_000, emAbertoCents: 90_000 })).toBe(0);
  });

  it('a mensagem do WhatsApp chama a pessoa pelo primeiro nome e leva o link', () => {
    const texto = whatsappChargeMessage({
      customerName: 'João Pereira',
      shopName: 'Oficina do Gabriel',
      amount: 'R$ 680,00',
      url: 'https://pagamento.exemplo/abc',
    });
    expect(texto).toContain('Oi, João!');
    expect(texto).toContain('R$ 680,00');
    expect(texto).toContain('https://pagamento.exemplo/abc');
  });
});
