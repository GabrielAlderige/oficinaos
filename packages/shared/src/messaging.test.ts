import { describe, expect, it } from 'vitest';
import { whatsappPostSaleMessage } from './aftersales';
import {
  corpoDoModelo,
  GRUPOS_DE_RESPOSTA,
  janelaAberta,
  minutosDeJanela,
  MODELOS_DE_MENSAGEM,
  modeloPorChave,
  nomePadraoDoModelo,
  oQuePodeEnviar,
  RESPOSTAS_RAPIDAS,
  respostasRapidas,
  telefoneParaApi,
} from './messaging';

const AGORA = new Date('2026-09-24T15:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

describe('janela de 24 horas', () => {
  it('cliente que escreveu agora deixa a conversa aberta', () => {
    expect(janelaAberta(horasAtras(1), AGORA)).toBe(true);
    expect(janelaAberta(horasAtras(23.5), AGORA)).toBe(true);
  });

  it('passadas 24 h, a janela fecha', () => {
    expect(janelaAberta(horasAtras(24.5), AGORA)).toBe(false);
  });

  it('cliente que nunca escreveu não abre janela nenhuma', () => {
    expect(janelaAberta(null, AGORA)).toBe(false);
    expect(minutosDeJanela(null, AGORA)).toBe(0);
  });

  it('o tempo restante é contado da última mensagem DELE', () => {
    expect(minutosDeJanela(horasAtras(23), AGORA)).toBe(60);
    expect(minutosDeJanela(horasAtras(30), AGORA)).toBe(0);
  });
});

describe('o que a tela pode oferecer', () => {
  it('sem canal conectado, tudo continua saindo pelo link', () => {
    const pode = oQuePodeEnviar({ canalConectado: false, ultimaEntradaEm: horasAtras(1), agora: AGORA });
    expect(pode.textoLivre).toBe(false);
    expect(pode.somenteModelo).toBe(false);
    expect(pode.motivo).toContain('link');
  });

  it('com a janela aberta, conversa normal', () => {
    const pode = oQuePodeEnviar({ canalConectado: true, ultimaEntradaEm: horasAtras(2), agora: AGORA });
    expect(pode.textoLivre).toBe(true);
    expect(pode.somenteModelo).toBe(false);
    expect(pode.motivo, 'a tela diz quanto tempo ainda resta').toMatch(/22 h/);
  });

  it('faltando menos de uma hora, o aviso vira minutos', () => {
    const pode = oQuePodeEnviar({ canalConectado: true, ultimaEntradaEm: horasAtras(23.5), agora: AGORA });
    expect(pode.motivo).toMatch(/30 min/);
  });

  it('com a janela fechada, só modelo aprovado', () => {
    const pode = oQuePodeEnviar({ canalConectado: true, ultimaEntradaEm: horasAtras(48), agora: AGORA });
    expect(pode.textoLivre).toBe(false);
    expect(pode.somenteModelo).toBe(true);
    expect(pode.motivo).toContain('24 h');
  });
});

describe('catálogo de modelos', () => {
  it('só mensagem de UTILIDADE pode sair sozinha', () => {
    for (const modelo of MODELOS_DE_MENSAGEM) {
      if (modelo.podeSerAutomatica) {
        expect(modelo.categoria, `${modelo.key} automática precisa ser de utilidade`).toBe('UTILITY');
      }
    }
  });

  it('pós-venda e reengajamento NUNCA saem sozinhos', () => {
    for (const key of ['POST_SALE', 'MAINTENANCE_DUE', 'NO_RETURN', 'REVIEW_INVITE'] as const) {
      expect(modeloPorChave(key)!.podeSerAutomatica, key).toBe(false);
    }
  });

  it('todo modelo diz o que faz e quais variáveis usa', () => {
    for (const modelo of MODELOS_DE_MENSAGEM) {
      expect(modelo.descricao.length, modelo.key).toBeGreaterThan(20);
      expect(modelo.variaveis.length, modelo.key).toBeGreaterThan(0);
    }
  });
});

describe('telefone para a API', () => {
  it('põe o código do país quando falta', () => {
    expect(telefoneParaApi('(11) 98765-4321')).toBe('5511987654321');
  });

  it('não duplica o 55 de quem já mandou completo', () => {
    expect(telefoneParaApi('+55 11 98765-4321')).toBe('5511987654321');
  });
});

describe('quem pode sair sozinha', () => {
  it('nenhuma mensagem de marketing pode ser automática', () => {
    for (const modelo of MODELOS_DE_MENSAGEM) {
      if (modelo.categoria === 'MARKETING') {
        expect(modelo.podeSerAutomatica, `${modelo.key}: reengajamento automático bloqueia o número`).toBe(false);
      }
    }
  });

  it('só tem gatilho quem pode ser automática', () => {
    // o contrário é o perigo: gatilho ligado em quem não pode sair sozinha
    for (const modelo of MODELOS_DE_MENSAGEM) {
      if (modelo.gatilho) expect(modelo.podeSerAutomatica, modelo.key).toBe(true);
    }
  });
});

describe('corpo do modelo para a Meta', () => {
  it('usa exatamente {{1}}..{{n}}, na quantidade de variáveis do catálogo', () => {
    for (const modelo of MODELOS_DE_MENSAGEM) {
      const corpo = corpoDoModelo(modelo.key);
      const usadas = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      const esperadas = modelo.variaveis.map((_, i) => i + 1);
      expect(
        [...new Set(usadas)].sort((a, b) => a - b),
        `${modelo.key}: a Meta recusa modelo com variável faltando ou fora de ordem`,
      ).toEqual(esperadas);
    }
  });

  it('o texto do modelo diz a mesma coisa que o texto de dentro da janela', () => {
    // a mesma mensagem sai de dois lugares (construtor do shared dentro da
    // janela, modelo aprovado fora dela): dizeres diferentes é o cliente
    // recebendo dois textos da mesma oficina
    const dentroDaJanela = whatsappPostSaleMessage({
      customerName: 'João Silva',
      shopName: 'Oficina do Gabriel',
      vehicle: { make: 'VW', model: 'Gol', plate: 'ABC1D23' },
      serviceName: null,
    });
    const comoModelo = corpoDoModelo('POST_SALE')
      .replace('{{1}}', 'João')
      .replace('{{2}}', 'Oficina do Gabriel')
      .replace('{{3}}', 'VW Gol (ABC1D23)');
    expect(comoModelo).toBe(dentroDaJanela);
  });

  it('sem nome informado, o modelo na Meta se chama como a chave', () => {
    expect(nomePadraoDoModelo('VEHICLE_READY')).toBe('vehicle_ready');
  });
});

describe('respostas rápidas', () => {
  const ctx = { cliente: 'João', oficina: 'Oficina do Gabriel', veiculo: 'VW Gol' };

  it('toda resposta sai escrita, sem sobrar marcação nenhuma', () => {
    for (const resposta of respostasRapidas(ctx)) {
      expect(resposta.body.length, resposta.key).toBeGreaterThan(10);
      expect(resposta.body, `${resposta.key}: ficou marcação no texto`).not.toMatch(/\{\{|\$\{|undefined/);
      expect(resposta.titulo.length, `${resposta.key}: o rótulo do botão precisa caber numa linha`).toBeLessThan(24);
    }
  });

  it('cobre o atendimento inteiro, da saudação ao pós-venda', () => {
    expect(GRUPOS_DE_RESPOSTA).toEqual([
      'Abertura',
      'Agendamento',
      'Na oficina',
      'Orçamento',
      'Peça',
      'Retirada',
      'Pagamento',
      'Pós-venda',
    ]);
    for (const grupo of GRUPOS_DE_RESPOSTA) {
      expect(RESPOSTAS_RAPIDAS.filter((r) => r.grupo === grupo).length, grupo).toBeGreaterThan(1);
    }
  });

  it('usa o nome do cliente e o carro dele quando o texto pede', () => {
    const escritas = respostasRapidas(ctx);
    expect(escritas.find((r) => r.key === 'SAUDACAO')!.body).toBe(
      'Olá, João! Aqui é da Oficina do Gabriel. Em que posso ajudar?',
    );
    expect(escritas.find((r) => r.key === 'PRONTO')!.body).toBe('Seu VW Gol está pronto para retirada.');
  });

  it('sem veículo no cadastro, o texto não fica capenga', () => {
    const semCarro = respostasRapidas({ ...ctx, veiculo: 'carro' });
    expect(semCarro.find((r) => r.key === 'PRONTO')!.body).toBe('Seu carro está pronto para retirada.');
  });

  it('chave repetida quebraria o botão: todas são únicas', () => {
    const chaves = RESPOSTAS_RAPIDAS.map((r) => r.key);
    expect(new Set(chaves).size).toBe(chaves.length);
  });
});
