import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantModel } from '../src/modules/assistant/assistant.service';
import { addMember, bearer, createPart, createTestApp, signup, type TestApp, type TestSession } from './helpers';

type Bloco = Record<string, unknown>;

const mensagem = (content: Bloco[], stop_reason: string): BetaMessage =>
  ({
    id: 'msg_teste',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  }) as unknown as BetaMessage;

/**
 * Um modelo falso com roteiro: devolve as respostas na ordem e guarda o que
 * recebeu. Nada sai para a internet, e o teste vê exatamente o que a API
 * mandaria para a Anthropic.
 */
function modeloComRoteiro(respostas: BetaMessage[]) {
  const recebidos: MessageCreateParamsNonStreaming[] = [];
  const model: AssistantModel = async (params) => {
    recebidos.push(structuredClone(params));
    const proxima = respostas.shift();
    if (!proxima) throw new Error('o roteiro acabou');
    return proxima;
  };
  return { model, recebidos };
}

/**
 * Assistente com IA (E49).
 *
 * O que precisa ficar provado: as buscas rodam de verdade no banco da
 * oficina e voltam para o modelo; o modelo só recebe as ferramentas que o
 * papel permite; o cadastro vira PROPOSTA e não grava nada; sem a chave, o
 * assistente fica desligado; e a configuração da chamada é a combinada
 * (modelo, esforço baixo, fallback da Anthropic).
 */
describe('assistente com IA', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;

  const perguntar = (texto: string, s: TestSession = dono) =>
    t.app.inject({
      method: 'POST',
      url: '/api/v1/assistant/chat',
      headers: bearer(s.accessToken),
      payload: { messages: [{ role: 'user', content: texto }] },
    });

  afterAll(async () => {
    await t.app.close();
  });

  it('a busca roda no banco da oficina e o resultado volta para o modelo', async () => {
    const chamadaDaBusca = [{ type: 'tool_use', id: 'tu_1', name: 'buscar_pecas', input: { busca: 'óleo' } }];
    const { model, recebidos } = modeloComRoteiro([
      mensagem(chamadaDaBusca, 'tool_use'),
      mensagem([{ type: 'text', text: 'Tem 12 unidades do Óleo 5W30 sintético, a R$ 49,00.' }], 'end_turn'),
    ]);
    t = await createTestApp({}, { assistantModel: model });
    dono = await signup(t.app);
    await createPart(t.app, dono, { name: 'Óleo 5W30 sintético', salePriceCents: 4_900, initialQuantity: 12 });

    const res = await perguntar('tem óleo 5w30?');
    expect(res.statusCode, res.body).toBe(200);
    const corpo = res.json();
    expect(corpo.reply).toContain('12 unidades');
    expect(corpo.links[0].label).toBe('Óleo 5W30 sintético');
    expect(corpo.proposals).toEqual([]);

    // a segunda chamada leva o resultado da busca, com o preço e o saldo de verdade
    const resultado = JSON.stringify(recebidos[1]!.messages.at(-1));
    expect(resultado).toContain('49,00');
    expect(resultado).toContain('\\"disponivel\\":12');

    // a chamada vai como combinado: o modelo configurado, esforço baixo e fallback padrão
    expect(recebidos[0]!.model).toBe('claude-opus-5-5');
    expect(recebidos[0]!.output_config).toEqual({ effort: 'low' });
    expect(recebidos[0]!.fallbacks).toBe('default');
    expect(recebidos[0]!.betas).toContain('server-side-fallback-2026-07-01');
    // a resposta do modelo volta inteira na conversa: nada é editado
    expect(recebidos[1]!.messages[1]).toEqual({ role: 'assistant', content: chamadaDaBusca });
  });

  it('cadastro vira proposta: nada é gravado', async () => {
    const { model } = modeloComRoteiro([
      mensagem(
        [{ type: 'tool_use', id: 'tu_2', name: 'propor_cadastro_de_cliente', input: { nome: 'João Prado', whatsapp: '35999990000', email: '' } }],
        'tool_use',
      ),
      mensagem([{ type: 'text', text: 'Preparei o cadastro do João. Confirme no botão.' }], 'end_turn'),
    ]);
    await t.app.close();
    t = await createTestApp({}, { assistantModel: model });
    dono = await signup(t.app);

    const res = await perguntar('cadastra o João Prado, 35 99999-0000');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().proposals).toEqual([{ kind: 'customer', name: 'João Prado', whatsapp: '35999990000', email: '' }]);
    const clientes = await t.app.inject({ method: 'GET', url: '/api/v1/customers?q=Prado', headers: bearer(dono.accessToken) });
    expect(clientes.json().data, 'o assistente não grava: quem confirma é a pessoa').toHaveLength(0);
  });

  it('o modelo só recebe as ferramentas que o papel permite', async () => {
    const { model, recebidos } = modeloComRoteiro([mensagem([{ type: 'text', text: 'Oi!' }], 'end_turn')]);
    await t.app.close();
    t = await createTestApp({}, { assistantModel: model });
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé');

    expect((await perguntar('oi', mecanico)).statusCode).toBe(200);
    const nomes = (recebidos[0]!.tools ?? []).map((tool) => (tool as { name: string }).name);
    expect(nomes).toContain('buscar_ordens_de_servico');
    expect(nomes, 'mecânico não cadastra cliente').not.toContain('propor_cadastro_de_cliente');
    expect(nomes, 'mecânico não mexe no catálogo').not.toContain('propor_cadastro_de_servico');
  });

  it('ferramenta pedida sem permissão volta como erro, sem rodar', async () => {
    const { model, recebidos } = modeloComRoteiro([
      mensagem(
        [{ type: 'tool_use', id: 'tu_3', name: 'propor_cadastro_de_servico', input: { nome: 'Alinhamento', preco_em_reais: 80, minutos: 40 } }],
        'tool_use',
      ),
      mensagem([{ type: 'text', text: 'Seu papel não permite cadastrar serviço.' }], 'end_turn'),
    ]);
    await t.app.close();
    t = await createTestApp({}, { assistantModel: model });
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé');

    const res = await perguntar('cadastra alinhamento a 80 reais', mecanico);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().proposals).toEqual([]);
    expect(JSON.stringify(recebidos[1]!.messages.at(-1))).toContain('"is_error":true');
  });

  it('recusa da IA vira uma resposta educada, não um erro', async () => {
    const { model } = modeloComRoteiro([mensagem([], 'refusal')]);
    await t.app.close();
    t = await createTestApp({}, { assistantModel: model });
    dono = await signup(t.app);
    const res = await perguntar('algo fora do lugar');
    expect(res.statusCode).toBe(200);
    expect(res.json().reply).toContain('Não posso ajudar');
  });

  it('sem a chave, o assistente fica desligado', async () => {
    await t.app.close();
    t = await createTestApp();
    dono = await signup(t.app);
    const status = await t.app.inject({ method: 'GET', url: '/api/v1/assistant/status', headers: bearer(dono.accessToken) });
    expect(status.json().enabled).toBe(false);
    const res = await perguntar('oi');
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('ASSISTANT_DISABLED');
  });
});
