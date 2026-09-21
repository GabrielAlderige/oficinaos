import { describe, expect, it } from 'vitest';
import { assuntoDoResumoDiario, deveRodarAgora, temAlgoARelatar, textoDoResumoDiario, type ResumoDoDia } from './automations';

describe('hora de rodar', () => {
  const base = { horaEscolhida: 8, ultimaExecucaoEm: null, hoje: '2026-09-21' };

  it('antes da hora escolhida, não roda', () => {
    expect(deveRodarAgora({ ...base, horaAgora: 7 })).toBe(false);
  });

  it('na hora, ou depois dela, roda', () => {
    expect(deveRodarAgora({ ...base, horaAgora: 8 })).toBe(true);
    expect(deveRodarAgora({ ...base, horaAgora: 15 })).toBe(true);
  });

  it('uma vez por dia: já rodou hoje, não roda de novo', () => {
    expect(deveRodarAgora({ ...base, horaAgora: 15, ultimaExecucaoEm: '2026-09-21' })).toBe(false);
  });

  it('rodou ontem, roda hoje', () => {
    expect(deveRodarAgora({ ...base, horaAgora: 9, ultimaExecucaoEm: '2026-09-20' })).toBe(true);
  });
});

describe('resumo do dia', () => {
  const vazio: ResumoDoDia = {
    shopName: 'Oficina do Gabriel',
    contatosHoje: 0,
    agendamentosAmanha: 0,
    orcamentosParados: 0,
    entregasAtrasadas: 0,
    aReceberVencidoCents: 0,
    appUrl: 'https://painel.exemplo',
  };

  it('dia sem nada pendente não vira e-mail', () => {
    expect(temAlgoARelatar(vazio), 'e-mail que não diz nada é spam').toBe(false);
  });

  it('qualquer pendência já justifica o e-mail', () => {
    expect(temAlgoARelatar({ ...vazio, contatosHoje: 1 })).toBe(true);
    expect(temAlgoARelatar({ ...vazio, aReceberVencidoCents: 100 })).toBe(true);
  });

  it('o texto lista só o que existe, no plural certo', () => {
    const texto = textoDoResumoDiario({
      ...vazio,
      contatosHoje: 1,
      orcamentosParados: 3,
      aReceberVencidoCents: 125_000,
    });
    expect(texto).toContain('Oficina do Gabriel');
    expect(texto).toContain('- 1 contato de pós-venda para hoje');
    expect(texto).toContain('- 3 orçamentos sem resposta');
    expect(texto).toContain('vencidos a receber');
    expect(texto, 'o que está zerado não entra').not.toContain('agendamento');
    expect(texto).toContain('https://painel.exemplo');
  });

  it('dia limpo, quando a oficina pediu o resumo assim mesmo, diz que está limpo', () => {
    expect(textoDoResumoDiario(vazio)).toContain('Nada pendente');
  });

  it('o assunto adianta o que pesa', () => {
    expect(assuntoDoResumoDiario({ ...vazio, contatosHoje: 2, orcamentosParados: 1 })).toBe(
      'OficinaOS: 2 contatos, 1 orçamento parado',
    );
    expect(assuntoDoResumoDiario(vazio)).toBe('OficinaOS: resumo do dia');
  });
});
