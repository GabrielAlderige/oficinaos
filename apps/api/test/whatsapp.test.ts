import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  assinaturaConfere,
  CloudApiMessaging,
  lerAviso,
  LinkMessaging,
  statusDoWhatsApp,
} from '../src/integrations/messaging/whatsapp';

/**
 * Contrato do WhatsApp oficial (E22).
 *
 * O driver ainda **não foi exercitado contra a API real** — falta uma conta
 * conectada. O que dá para provar sem ela, e é o que quebra na hora de ligar,
 * está aqui: o formato do envio (texto e modelo), a tradução do que volta, a
 * leitura do aviso e a recusa de aviso sem assinatura válida.
 */
interface Chamada {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function apiFalsa(resposta: unknown, status = 200) {
  const chamadas: Chamada[] = [];
  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify(resposta), { status });
  }) as typeof fetch;

  const provider = new CloudApiMessaging({
    phoneNumberId: '1234567890',
    accessToken: 'token-da-oficina',
    fetch: fetchFalso,
  });
  return { provider, chamadas };
}

describe('link do WhatsApp', () => {
  it('devolve o link com o texto pronto, e não promete entrega', async () => {
    const envio = await new LinkMessaging().enviar({ para: '(11) 98765-4321', texto: 'Olá, João!' });
    expect(envio.whatsappUrl).toContain('https://wa.me/5511987654321');
    expect(envio.whatsappUrl).toContain(encodeURIComponent('Olá, João!'));
    expect(envio.status, 'sem a API, "entregue" seria mentira de tela').toBe('LINK_OPENED');
    expect(envio.providerMessageId).toBeNull();
  });
});

describe('driver da Cloud API', () => {
  it('manda texto livre para o número do cliente, com o token no header', async () => {
    const { provider, chamadas } = apiFalsa({ messages: [{ id: 'wamid.ABC' }] });
    const envio = await provider.enviar({ para: '(11) 98765-4321', texto: 'Seu carro está pronto.' });

    expect(chamadas[0]!.url).toContain('/1234567890/messages');
    expect(chamadas[0]!.headers.authorization, 'o token vai no header, nunca na URL').toBe('Bearer token-da-oficina');
    const corpo = chamadas[0]!.body as { to: string; type: string; text: { body: string } };
    expect(corpo.to, 'o 55 entra quando falta').toBe('5511987654321');
    expect(corpo.type).toBe('text');
    expect(corpo.text.body).toBe('Seu carro está pronto.');

    expect(envio.providerMessageId).toBe('wamid.ABC');
    expect(envio.status).toBe('SENT');
  });

  it('com a janela fechada, manda o MODELO com as variáveis na ordem', async () => {
    const { provider, chamadas } = apiFalsa({ messages: [{ id: 'wamid.T' }] });
    await provider.enviar({
      para: '5511987654321',
      texto: 'irrelevante quando há modelo',
      modelo: { nome: 'veiculo_pronto', idioma: 'pt_BR', variaveis: ['João', 'Oficina do Gabriel'] },
    });

    const corpo = chamadas[0]!.body as {
      type: string;
      template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
    };
    expect(corpo.type).toBe('template');
    expect(corpo.template.name).toBe('veiculo_pronto');
    expect(corpo.template.language.code).toBe('pt_BR');
    expect(corpo.template.components[0]!.parameters.map((p) => p.text)).toEqual(['João', 'Oficina do Gabriel']);
  });

  it('erro da Meta sobe com a mensagem legível dela', async () => {
    const { provider } = apiFalsa(
      { error: { message: 'Template name does not exist in the translation', error_user_msg: 'Modelo não encontrado' } },
      400,
    );
    await expect(provider.enviar({ para: '5511987654321', texto: 'oi' })).rejects.toThrow('Modelo não encontrado');
  });
});

describe('aviso da Meta', () => {
  const SEGREDO = 'segredo-do-app';
  const corpo = JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1234567890' },
              messages: [
                { from: '5511987654321', id: 'wamid.IN', timestamp: '1790000000', type: 'text', text: { body: 'Pode fazer' } },
                { from: '5511987654321', id: 'wamid.AUDIO', timestamp: '1790000001', type: 'audio' },
              ],
              statuses: [{ id: 'wamid.OUT', status: 'read' }],
            },
          },
        ],
      },
    ],
  });

  it('sem assinatura válida, o aviso não entra', () => {
    expect(assinaturaConfere(corpo, undefined, SEGREDO)).toBe(false);
    expect(assinaturaConfere(corpo, 'sha256=naoconfere', SEGREDO)).toBe(false);
    const outra = createHmac('sha256', 'outro-segredo').update(corpo).digest('hex');
    expect(assinaturaConfere(corpo, `sha256=${outra}`, SEGREDO)).toBe(false);
  });

  it('com a assinatura certa, entra', () => {
    const certa = createHmac('sha256', SEGREDO).update(corpo).digest('hex');
    expect(assinaturaConfere(corpo, `sha256=${certa}`, SEGREDO)).toBe(true);
  });

  it('lê o que o cliente escreveu e o que aconteceu com o que saiu', () => {
    const aviso = lerAviso(corpo)!;
    expect(aviso.phoneNumberId, 'é por ele que se descobre a oficina').toBe('1234567890');
    expect(aviso.entradas).toHaveLength(1);
    expect(aviso.entradas[0]!.texto).toBe('Pode fazer');
    expect(aviso.entradas[0]!.de).toBe('5511987654321');
    expect(aviso.situacoes[0]).toEqual({ providerMessageId: 'wamid.OUT', status: 'READ', erro: null });
  });

  it('áudio e imagem não viram linha vazia no histórico', () => {
    const aviso = lerAviso(corpo)!;
    expect(aviso.entradas.some((entrada) => entrada.providerMessageId === 'wamid.AUDIO')).toBe(false);
  });

  it('aviso de outro assunto é ignorado', () => {
    expect(lerAviso(JSON.stringify({ entry: [{ changes: [{ value: {} }] }] }))).toBeNull();
  });

  it('situação desconhecida nunca vira "entregue"', () => {
    expect(statusDoWhatsApp('delivered')).toBe('DELIVERED');
    expect(statusDoWhatsApp('failed')).toBe('FAILED');
    expect(statusDoWhatsApp('coisa_nova')).toBe('SENT');
  });
});
