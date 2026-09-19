import { describe, expect, it } from 'vitest';
import {
  mediaDasNotas,
  proximaRevisao,
  taxaDeConversaoBps,
  valorEmAbertoCents,
  whatsappNoReturnMessage,
  whatsappPostSaleMessage,
  whatsappReviewInviteMessage,
  type FunilPorEtapa,
} from './aftersales';

describe('próxima revisão', () => {
  it('sem intervalo nenhum não há revisão a lembrar', () => {
    expect(
      proximaRevisao({ feitoEm: '2026-09-18', intervalMonths: null, intervalKm: null, kmNoServico: 10_000, kmAtual: 12_000 }),
    ).toBeNull();
  });

  it('só por tempo: seis meses depois do serviço', () => {
    const revisao = proximaRevisao({
      feitoEm: '2026-09-18',
      intervalMonths: 6,
      intervalKm: null,
      kmNoServico: null,
      kmAtual: null,
    });
    expect(revisao).toEqual({ dueOn: '2027-03-18', kmRestantes: null });
  });

  it('vale o que vencer primeiro: rodando muito, o km chega antes do tempo', () => {
    const revisao = proximaRevisao({
      feitoEm: '2026-09-18',
      intervalMonths: 12,
      intervalKm: 10_000,
      kmNoServico: 50_000,
      kmAtual: 58_000,
      kmPorDia: 100,
    });
    // faltam 2.000 km a 100 km/dia = 20 dias
    expect(revisao).toEqual({ dueOn: '2026-10-08', kmRestantes: 2_000 });
  });

  it('31 de janeiro + 1 mês é 28 de fevereiro, não 3 de março', () => {
    expect(
      proximaRevisao({ feitoEm: '2026-01-31', intervalMonths: 1, intervalKm: null, kmNoServico: null, kmAtual: null })!.dueOn,
    ).toBe('2026-02-28');
  });

  it('sem km atual, o intervalo de km não conta (não dá para adivinhar o quanto rodou)', () => {
    const revisao = proximaRevisao({
      feitoEm: '2026-09-18',
      intervalMonths: null,
      intervalKm: 10_000,
      kmNoServico: 50_000,
      kmAtual: null,
    });
    expect(revisao).toBeNull();
  });
});

describe('funil do CRM', () => {
  const etapas: FunilPorEtapa[] = [
    { stage: 'NEW', count: 3, valueCents: 300_000 },
    { stage: 'CONTACTED', count: 2, valueCents: 150_000 },
    { stage: 'WON', count: 3, valueCents: 400_000 },
    { stage: 'LOST', count: 1, valueCents: 90_000 },
  ];

  it('a conversão é sobre o que já foi decidido: lead novo não conta como perda', () => {
    // 3 ganhos de 4 decididos = 75%
    expect(taxaDeConversaoBps(etapas)).toBe(7_500);
  });

  it('sem nada decidido, a conversão é zero e não uma divisão por zero', () => {
    expect(taxaDeConversaoBps([{ stage: 'NEW', count: 5, valueCents: 100 }])).toBe(0);
  });

  it('o valor em aberto soma só as etapas vivas', () => {
    expect(valorEmAbertoCents(etapas)).toBe(450_000);
  });
});

describe('avaliações e mensagens', () => {
  it('a média arredonda a uma casa', () => {
    expect(mediaDasNotas([5, 4, 4])).toBe(4.3);
    expect(mediaDasNotas([])).toBe(0);
  });

  it('a mensagem de pós-venda pergunta, e chama a pessoa pelo primeiro nome', () => {
    const texto = whatsappPostSaleMessage({
      customerName: 'João Pereira da Silva',
      shopName: 'Oficina do Zé',
      vehicle: { make: 'Fiat', model: 'Argo', plate: 'ABC1D23' },
      serviceName: 'Troca de óleo',
    });
    expect(texto).toContain('Olá, João!');
    expect(texto).toContain('Fiat Argo (ABC1D23)');
    expect(texto).toContain('Está tudo certo com o carro?');
  });

  it('o convite para avaliar leva o link, e serve para qualquer cliente', () => {
    const texto = whatsappReviewInviteMessage({
      customerName: 'Maria',
      shopName: 'Oficina do Zé',
      url: 'https://app.local/avaliacao/abc',
    });
    expect(texto).toContain('https://app.local/avaliacao/abc');
    expect(texto).not.toMatch(/5 estrelas|nota máxima/i);
  });

  it('a mensagem de cliente sumido não inventa promoção', () => {
    const texto = whatsappNoReturnMessage({ customerName: 'Ana', shopName: 'Oficina', vehicle: null });
    expect(texto).toContain('Faz um tempo');
    expect(texto).not.toMatch(/desconto|promoção|oferta/i);
  });
});
