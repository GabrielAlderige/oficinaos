import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCustomer,
  createTestApp,
  createVehicle,
  signup,
  testDb,
  type TestApp,
  type TestSession,
} from './helpers';

/** `formatBRL` usa espaço fino (U+00A0) entre "R$" e o número. */
const semEspacoEstranho = (valor: string) =>
  valor.replace(new RegExp(String.fromCharCode(0x00a0, 0x202f, 0x2009).split('').join('|'), 'g'), ' ');

const PHONE_ID = '109876543210987';
const TOKEN = 'EAAG-token-da-oficina-1234567890-ABCD';
const APP_SECRET = 'segredo-do-app-da-oficina';

interface Canal {
  provider: string;
  status: string;
  displayPhone: string | null;
  phoneNumberId: string | null;
  tokenHint: string | null;
  webhookUrl: string | null;
  verifyToken: string | null;
  lastError: string | null;
  autoSend: string[];
}
interface Modelo {
  key: string;
  status: string;
  automatica: boolean;
  podeSerAutomatica: boolean;
  exemplo: string;
  variaveis: string[];
}
interface Visao {
  channel: Canal;
  templates: Modelo[];
}
interface Mensagem {
  id: string;
  direction: string;
  body: string;
  status: string;
  templateKey: string | null;
  failureReason: string | null;
}
interface Conversa {
  customerId: string;
  customerName: string;
  channelConnected: boolean;
  canSendFreeText: boolean;
  onlyTemplate: boolean;
  windowReason: string;
  whatsappUrl: string | null;
  messages: Mensagem[];
}
interface Envio {
  conversation: Conversa;
  whatsappUrl: string | null;
  via: string;
  repeated: boolean;
}

/** O que o servidor falso da Meta recebeu. */
interface Chamada {
  method: string;
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/**
 * WhatsApp oficial e conversa dentro do sistema (V3, E22).
 *
 * **Nenhum teste fala com a Meta.** No lugar dela sobe um servidor local que
 * responde como a Cloud API responde — é assim que dá para provar o formato do
 * envio, o token no header e o que acontece quando ela recusa, sem conta
 * conectada e sem mandar mensagem para ninguém.
 *
 * O que precisa ficar provado: sem canal conectado nada muda (o link `wa.me`
 * continua), o token não volta para a tela, a janela de 24 h decide o que sai,
 * modelo não aprovado não sai fora da janela, pós-venda não pode ser
 * automático, e o aviso da Meta só entra com assinatura válida.
 */
describe('whatsapp oficial e conversa', () => {
  let t: TestApp;
  let dono: TestSession;
  let mecanico: TestSession;
  let chamadas: Chamada[] = [];
  let meta: Server;
  /** o que o servidor falso responde na próxima chamada */
  let respostaDaMeta: { status: number; corpo: unknown } = { status: 200, corpo: {} };
  let sequencia = 0;

  const post = (url: string, payload: unknown = {}, s: TestSession = dono) =>
    t.app.inject({ method: 'POST', url, headers: bearer(s.accessToken), payload: payload as never });
  const get = (url: string, s: TestSession = dono) =>
    t.app.inject({ method: 'GET', url, headers: bearer(s.accessToken) });
  const put = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PUT', url, headers: bearer(s.accessToken), payload: payload as never });
  const patch = (url: string, payload: unknown, s: TestSession = dono) =>
    t.app.inject({ method: 'PATCH', url, headers: bearer(s.accessToken), payload: payload as never });

  async function clienteComCarro(nome = 'João Pereira', whatsapp = '(11) 91234-5678') {
    const cliente = await createCustomer(t.app, dono, { name: nome, whatsapp });
    await createVehicle(t.app, dono, cliente.id, {
      make: 'VW',
      model: 'Gol',
      plate: `MSG${1000 + sequencia++}`,
    });
    return cliente;
  }

  /**
   * O que está guardado no banco, lido com o RLS ligado: sem `app.org_id` na
   * sessão, a linha da oficina não é visível nem para o teste.
   */
  async function canalNoBanco(orgId: string): Promise<{ access_token_enc: string | null }> {
    const client = await testDb().pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
      const { rows } = await client.query<{ access_token_enc: string | null }>(
        'select access_token_enc from messaging_channels where organization_id = $1',
        [orgId],
      );
      await client.query('commit');
      return rows[0] ?? { access_token_enc: null };
    } finally {
      client.release();
    }
  }

  const conectar = (extra: Record<string, unknown> = {}) =>
    post('/api/v1/messaging/channel', {
      phoneNumberId: PHONE_ID,
      accessToken: TOKEN,
      appSecret: APP_SECRET,
      ...extra,
    });

  const enviar = (customerId: string, payload: Record<string, unknown>, s: TestSession = dono) =>
    post(`/api/v1/messaging/conversations/${customerId}/messages`, { clientRequestId: randomUUID(), ...payload }, s);

  const conversa = async (customerId: string): Promise<Conversa> =>
    (await get(`/api/v1/messaging/conversations/${customerId}`)).json() as Conversa;

  /** O aviso da Meta, assinado como ela assina: HMAC do corpo CRU. */
  function avisar(corpo: unknown, opcoes: { segredo?: string; orgId?: string } = {}) {
    const bruto = JSON.stringify(corpo);
    const assinatura = createHmac('sha256', opcoes.segredo ?? APP_SECRET).update(bruto).digest('hex');
    return t.app.inject({
      method: 'POST',
      url: `/api/v1/webhooks/whatsapp/${opcoes.orgId ?? dono.orgId}`,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${assinatura}` },
      payload: bruto,
    });
  }

  const avisoDeEntrada = (de: string, texto: string, id: string, quando = Math.floor(Date.now() / 1000)) => ({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_ID },
              messages: [{ from: de, id, timestamp: String(quando), type: 'text', text: { body: texto } }],
            },
          },
        ],
      },
    ],
  });

  beforeAll(async () => {
    meta = createServer((req, res) => {
      let corpo = '';
      req.on('data', (parte) => (corpo += parte));
      req.on('end', () => {
        chamadas.push({
          method: req.method ?? '',
          url: req.url ?? '',
          authorization: req.headers.authorization,
          body: corpo ? (JSON.parse(corpo) as Record<string, unknown>) : {},
        });
        res.writeHead(respostaDaMeta.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(respostaDaMeta.corpo));
      });
    });
    await new Promise<void>((resolve) => meta.listen(0, '127.0.0.1', resolve));
    const porta = (meta.address() as AddressInfo).port;

    t = await createTestApp({ WHATSAPP_BASE_URL: `http://127.0.0.1:${porta}/v21.0` });
    dono = await signup(t.app);
    mecanico = await addMember(t.app, dono, 'MECHANIC', 'Zé Mecânico');
  });

  afterAll(async () => {
    await t.app.close();
    await new Promise<void>((resolve) => meta.close(() => resolve()));
  });

  // --------------------------- sem canal nenhum ---------------------------

  describe('sem canal conectado', () => {
    it('a mensagem sai pelo link e fica no histórico da conversa', async () => {
      const cliente = await clienteComCarro();
      const res = await enviar(cliente.id, { body: 'Bom dia! Seu carro entrou na oficina.' });
      expect(res.statusCode, res.body).toBe(201);

      const envio = res.json() as Envio;
      expect(envio.via, 'sem conta na Meta, é o link de sempre').toBe('LINK');
      expect(envio.whatsappUrl).toContain('https://wa.me/5511912345678');
      expect(envio.conversation.messages).toHaveLength(1);
      expect(envio.conversation.messages[0]!.status, 'o link não confirma entrega').toBe('LINK_OPENED');
      expect(envio.conversation.channelConnected).toBe(false);
      expect(envio.conversation.windowReason).toContain('link');
      expect(chamadas, 'sem canal, nada é enviado pela API').toHaveLength(0);
    });

    it('a conversa aparece na lista, com o começo da última mensagem', async () => {
      const lista = (await get('/api/v1/messaging/conversations')).json() as {
        customerName: string;
        lastPreview: string;
        unread: number;
        windowOpen: boolean;
      }[];
      expect(lista[0]!.customerName).toBe('João Pereira');
      expect(lista[0]!.lastPreview).toContain('Seu carro entrou');
      expect(lista[0]!.windowOpen, 'o cliente ainda não escreveu nada').toBe(false);
    });

    it('cliente sem WhatsApp no cadastro não deixa enviar, e explica', async () => {
      const semZap = await createCustomer(t.app, dono, { name: 'Sem Telefone' });
      const res = await enviar(semZap.id, { body: 'oi' });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('CUSTOMER_WITHOUT_WHATSAPP');
    });

    it('os modelos de pós-venda já vêm escritos, esperando o botão', async () => {
      const cliente = await clienteComCarro('Maria Silva', '(11) 99888-7766');
      const { templates: modelos, quickReplies } = (
        await get(`/api/v1/messaging/conversations/${cliente.id}/templates`)
      ).json() as {
        templates: { templateKey: string; body: string; via: string; whatsappUrl: string | null; blocker: string | null }[];
        quickReplies: { key: string; grupo: string; titulo: string; body: string }[];
      };

      // as respostas rápidas vêm escritas com o nome e o carro do cliente:
      // elas preenchem o campo de texto, não saem sozinhas
      expect(quickReplies.length, 'o catálogo inteiro chega pronto').toBeGreaterThan(10);
      expect(quickReplies.find((r) => r.key === 'PRONTO')!.body).toBe('Seu VW Gol está pronto para retirada.');
      expect(quickReplies.find((r) => r.key === 'SAUDACAO')!.body).toContain('Maria');
      expect(new Set(quickReplies.map((r) => r.grupo)).size, 'agrupadas por etapa do atendimento').toBeGreaterThan(4);

      const posVenda = modelos.find((m) => m.templateKey === 'POST_SALE')!;
      expect(posVenda.body, 'o texto vem com o nome de quem vai receber').toContain('Maria');
      expect(posVenda.body).toContain('VW Gol');
      expect(posVenda.blocker, 'nada impede o envio: falta apertar o botão').toBeNull();
      expect(posVenda.whatsappUrl).toContain('wa.me');
      expect(modelos.map((m) => m.templateKey)).toEqual(['POST_SALE', 'MAINTENANCE_DUE', 'NO_RETURN']);
    });

    it('mecânico não abre a conversa dos clientes', async () => {
      const res = await get('/api/v1/messaging/conversations', mecanico);
      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------- conectar o canal --------------------------

  describe('conectar o WhatsApp da oficina', () => {
    it('usa a credencial na Meta antes de guardar, e o token não volta para a tela', async () => {
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { display_phone_number: '+55 11 3333-4444' } };
      const res = await conectar({ wabaId: '444555666' });
      expect(res.statusCode, res.body).toBe(200);

      expect(chamadas[0]!.method, 'a credencial é testada, não só guardada').toBe('GET');
      expect(chamadas[0]!.url).toContain(`/v21.0/${PHONE_ID}`);
      expect(chamadas[0]!.authorization).toBe(`Bearer ${TOKEN}`);

      const visao = res.json() as Visao;
      expect(visao.channel.status).toBe('CONNECTED');
      expect(visao.channel.provider).toBe('CLOUD_API');
      expect(visao.channel.displayPhone, 'o número vem da Meta, não do formulário').toBe('+55 11 3333-4444');
      expect(visao.channel.tokenHint).toBe('••••ABCD');
      expect(res.body, 'o token da oficina não sai da API, em nenhum campo').not.toContain(TOKEN);
      expect(res.body).not.toContain(APP_SECRET);
      expect(visao.channel.webhookUrl).toContain(`/api/v1/webhooks/whatsapp/${dono.orgId}`);
      expect(visao.channel.verifyToken).toBeTruthy();
    });

    it('o token vai cifrado para o banco', async () => {
      const linha = await canalNoBanco(dono.orgId);
      expect(linha.access_token_enc, 'vazar o banco não pode entregar o WhatsApp da oficina').not.toContain(TOKEN);
      expect(linha.access_token_enc!.split('.')).toHaveLength(3);
    });

    it('a Meta recusando a credencial não deixa o canal "conectado"', async () => {
      const outra = await signup(t.app);
      respostaDaMeta = { status: 401, corpo: { error: { message: 'Invalid OAuth access token' } } };
      const res = await post(
        '/api/v1/messaging/channel',
        { phoneNumberId: '999888777', accessToken: 'token-errado-mas-comprido', appSecret: APP_SECRET },
        outra,
      );
      expect(res.statusCode).toBe(422);
      expect(res.json().detail).toContain('Invalid OAuth access token');

      const visao = (await get('/api/v1/messaging/channel', outra)).json() as Visao;
      expect(visao.channel.status).toBe('DISCONNECTED');
      respostaDaMeta = { status: 200, corpo: { display_phone_number: '+55 11 3333-4444' } };
    });

    it('a verificação do endereço devolve o desafio da Meta, e recusa token errado', async () => {
      const visao = (await get('/api/v1/messaging/channel')).json() as Visao;
      const url = `/api/v1/webhooks/whatsapp/${dono.orgId}?hub.mode=subscribe&hub.challenge=1234&hub.verify_token=`;

      const certo = await t.app.inject({ method: 'GET', url: url + encodeURIComponent(visao.channel.verifyToken!) });
      expect(certo.statusCode).toBe(200);
      expect(certo.body, 'a Meta espera o desafio cru').toBe('1234');

      const errado = await t.app.inject({ method: 'GET', url: `${url}token-de-outro` });
      expect(errado.statusCode).toBe(403);
    });

    it('só modelo de utilidade pode sair sozinho', async () => {
      const proibido = await put('/api/v1/messaging/auto-send', { autoSend: ['POST_SALE'] });
      expect(proibido.statusCode, 'marketing automático é número bloqueado').toBe(422);
      expect(proibido.json().detail).toContain('apertar enviar');

      const semGatilho = await put('/api/v1/messaging/auto-send', { autoSend: ['QUOTE_SENT'] });
      expect(semGatilho.statusCode, 'utilidade sem evento que a dispare também não passa').toBe(422);
      expect(semGatilho.json().detail).toContain('ainda não tem envio automático');

      const permitido = await put('/api/v1/messaging/auto-send', { autoSend: ['VEHICLE_READY'] });
      expect(permitido.statusCode, permitido.body).toBe(200);
      expect((permitido.json() as Visao).channel.autoSend).toEqual(['VEHICLE_READY']);
    });

    it('o modelo para colar na Meta vem com {{1}}, {{2}}…', async () => {
      const visao = (await get('/api/v1/messaging/channel')).json() as Visao;
      const posVenda = visao.templates.find((m) => m.key === 'POST_SALE')!;
      expect(posVenda.exemplo).toContain('{{1}}');
      expect(posVenda.exemplo).toContain('{{3}}');
      expect(posVenda.podeSerAutomatica, 'pós-venda espera o botão, sempre').toBe(false);
      expect(posVenda.status).toBe('NOT_SUBMITTED');
    });
  });

  // ------------------------------- enviando -------------------------------

  describe('com o canal conectado', () => {
    it('fora da janela de 24 h, texto livre não sai', async () => {
      const cliente = await clienteComCarro('Carlos Dias', '(11) 97777-1111');
      const res = await enviar(cliente.id, { body: 'Passa aqui amanhã?' });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('WHATSAPP_WINDOW_CLOSED');
      expect(chamadas.filter((c) => c.method === 'POST'), 'nada foi mandado').toHaveLength(0);
    });

    it('fora da janela, modelo não aprovado também não sai', async () => {
      const cliente = await clienteComCarro('Ana Costa', '(11) 96666-2222');
      const res = await enviar(cliente.id, { templateKey: 'POST_SALE' });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('WHATSAPP_TEMPLATE_NOT_APPROVED');
    });

    it('modelo aprovado sai como modelo, com as variáveis na ordem do catálogo', async () => {
      const cliente = await clienteComCarro('Bruno Lima', '(11) 95555-3333');
      await patch('/api/v1/messaging/templates', { key: 'POST_SALE', status: 'APPROVED' });
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: 'wamid.SAIU1' }] } };

      const res = await enviar(cliente.id, { templateKey: 'POST_SALE' });
      expect(res.statusCode, res.body).toBe(201);

      const envio = res.json() as Envio;
      expect(envio.via).toBe('CLOUD_API');
      expect(envio.whatsappUrl, 'quem envia é o servidor: não há link para abrir').toBeNull();
      expect(envio.conversation.messages[0]!.status).toBe('SENT');
      expect(envio.conversation.messages[0]!.templateKey).toBe('POST_SALE');

      const corpo = chamadas[0]!.body as {
        to: string;
        type: string;
        template: { name: string; language: { code: string }; components: { parameters: { text: string }[] }[] };
      };
      expect(corpo.to).toBe('5511955553333');
      expect(corpo.type, 'fora da janela, a Meta só entrega modelo').toBe('template');
      expect(corpo.template.name).toBe('post_sale');
      expect(corpo.template.components[0]!.parameters.map((p) => p.text)).toEqual([
        'Bruno',
        'Oficina Teste',
        'VW Gol',
      ]);
    });

    it('a Meta recusando o envio registra a falha com o motivo dela', async () => {
      const cliente = await clienteComCarro('Diego Souza', '(11) 94444-4444');
      respostaDaMeta = {
        status: 400,
        corpo: { error: { message: 'Template not found', error_user_msg: 'Modelo não encontrado' } },
      };
      const res = await enviar(cliente.id, { templateKey: 'POST_SALE' });
      expect(res.statusCode).toBe(502);
      expect(res.json().detail).toContain('Modelo não encontrado');

      const fio = await conversa(cliente.id);
      expect(fio.messages[0]!.status, 'a mensagem que falhou não desaparece').toBe('FAILED');
      expect(fio.messages[0]!.failureReason).toContain('Modelo não encontrado');
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: 'wamid.OK' }] } };
    });

    it('o mesmo POST repetido não manda a mensagem duas vezes', async () => {
      const cliente = await clienteComCarro('Elisa Prado', '(11) 93333-5555');
      const mesmoPedido = randomUUID();
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: `wamid.${randomUUID()}` }] } };
      chamadas = [];

      const primeiro = await enviar(cliente.id, { templateKey: 'POST_SALE', clientRequestId: mesmoPedido });
      const segundo = await enviar(cliente.id, { templateKey: 'POST_SALE', clientRequestId: mesmoPedido });
      expect(primeiro.statusCode).toBe(201);
      expect(segundo.statusCode).toBe(201);
      expect((segundo.json() as Envio).repeated).toBe(true);
      expect(chamadas.filter((c) => c.method === 'POST'), 'a Meta foi chamada uma vez só').toHaveLength(1);
      expect((await conversa(cliente.id)).messages).toHaveLength(1);
    });
  });

  // -------------------------- o cliente respondeu -------------------------

  describe('o aviso da Meta', () => {
    it('a resposta do cliente entra na conversa, abre a janela e conta como não lida', async () => {
      const cliente = await clienteComCarro('Fábio Rocha', '(11) 92222-6666');
      const res = await avisar(avisoDeEntrada('5511922226666', 'Pode fazer o serviço', `wamid.IN-${randomUUID()}`));
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().handled).toBe(true);

      const fio = await conversa(cliente.id);
      expect(fio.messages.at(-1)!.body).toBe('Pode fazer o serviço');
      expect(fio.messages.at(-1)!.direction).toBe('INBOUND');
      expect(fio.canSendFreeText, 'o cliente escreveu: dá para conversar normal').toBe(true);
      expect(fio.onlyTemplate).toBe(false);

      const lista = (await get('/api/v1/messaging/conversations')).json() as {
        customerId: string;
        unread: number;
        windowOpen: boolean;
      }[];
      const dele = lista.find((c) => c.customerId === cliente.id)!;
      expect(dele.unread).toBe(1);
      expect(dele.windowOpen).toBe(true);

      await post(`/api/v1/messaging/conversations/${cliente.id}/read`);
      const depois = (await get('/api/v1/messaging/conversations')).json() as { customerId: string; unread: number }[];
      expect(depois.find((c) => c.customerId === cliente.id)!.unread).toBe(0);
    });

    it('com a janela aberta, o texto livre sai como texto (sem modelo nenhum)', async () => {
      const cliente = await clienteComCarro('Gina Alves', '(11) 91111-7777');
      await avisar(avisoDeEntrada('5511911117777', 'Bom dia', `wamid.IN-${randomUUID()}`));
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: `wamid.${randomUUID()}` }] } };

      const res = await enviar(cliente.id, { body: 'Bom dia! Já estamos com o carro na rampa.' });
      expect(res.statusCode, res.body).toBe(201);
      const corpo = chamadas[0]!.body as { type: string; text: { body: string } };
      expect(corpo.type, 'dentro da janela não precisa de modelo aprovado').toBe('text');
      expect(corpo.text.body).toContain('na rampa');
    });

    it('aviso sem assinatura válida não entra', async () => {
      const cliente = await clienteComCarro('Hugo Neves', '(11) 90000-8888');
      const res = await avisar(avisoDeEntrada('5511900008888', 'Oi', `wamid.IN-${randomUUID()}`), {
        segredo: 'outro-segredo',
      });
      expect(res.statusCode).toBe(401);
      expect((await conversa(cliente.id)).messages, 'nada gravado').toHaveLength(0);
    });

    it('o mesmo aviso repetido não duplica a mensagem', async () => {
      const cliente = await clienteComCarro('Ivo Martins', '(11) 98888-9999');
      const aviso = avisoDeEntrada('5511988889999', 'Cheguei', `wamid.IN-repetido-${sequencia}`);
      const primeiro = await avisar(aviso);
      const segundo = await avisar(aviso);
      expect(primeiro.json().handled).toBe(true);
      expect(segundo.json().reason, 'o segundo não grava nada de novo').toContain('0 nova(s)');
      expect((await conversa(cliente.id)).messages).toHaveLength(1);
    });

    it('o "lido" da Meta atualiza a mensagem que saiu', async () => {
      const cliente = await clienteComCarro('Joana Reis', '(11) 97777-0000');
      await avisar(avisoDeEntrada('5511977770000', 'Oi', `wamid.IN-${randomUUID()}`));
      const idNaMeta = `wamid.OUT-${randomUUID()}`;
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: idNaMeta }] } };
      await enviar(cliente.id, { body: 'Seu carro está pronto.' });

      const res = await avisar({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: PHONE_ID },
                  statuses: [{ id: idNaMeta, status: 'read' }],
                },
              },
            ],
          },
        ],
      });
      expect(res.json().reason).toContain('1 situação');
      const fio = await conversa(cliente.id);
      expect(fio.messages.find((m) => m.body.includes('está pronto'))!.status).toBe('READ');
    });

    it('mensagem de número fora do cadastro não se perde, mas não abre conversa', async () => {
      const res = await avisar(avisoDeEntrada('5521999990000', 'Vocês montam som?', `wamid.IN-${randomUUID()}`));
      expect(res.json().reason).toContain('1 sem cadastro');
      const lista = (await get('/api/v1/messaging/conversations')).json() as { customerName: string }[];
      expect(lista.some((c) => c.customerName === 'Vocês montam som?')).toBe(false);
    });

    it('aviso endereçado a outra oficina é recusado', async () => {
      const outra = await signup(t.app);
      const res = await avisar(avisoDeEntrada('5511912345678', 'Oi', `wamid.IN-${randomUUID()}`), {
        orgId: outra.orgId,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --------------------- aviso que nasce em outra tela --------------------

  /**
   * O pedido dele: "quero que prepare o ambiente para as mensagens já enviarem
   * no WhatsApp do cliente". Com o canal conectado, o aviso que nasce na OS ou
   * no orçamento sai pelo servidor; e o que a oficina marcou como automático
   * sai **sozinho**, na hora do evento.
   */
  describe('aviso do sistema', () => {
    let servicoId: string;

    async function osPronta(cliente: { id: string }, veiculoId: string) {
      const os = (
        await post('/api/v1/work-orders', {
          customerId: cliente.id,
          vehicleId: veiculoId,
          items: [{ type: 'SERVICE', serviceId: servicoId }],
        })
      ).json() as { id: string };
      const orcamento = (await post(`/api/v1/work-orders/${os.id}/quotes`, {})).json() as { id: string };
      await post(`/api/v1/quotes/${orcamento.id}/manual-decision`, { decision: 'APPROVED', channel: 'PHONE' });
      await post(`/api/v1/work-orders/${os.id}/start`);
      return { os, orcamento };
    }

    async function clienteComVeiculo(nome: string, whatsapp: string) {
      const cliente = await createCustomer(t.app, dono, { name: nome, whatsapp });
      const veiculo = await createVehicle(t.app, dono, cliente.id, {
        make: 'VW',
        model: 'Gol',
        plate: `MSG${1000 + sequencia++}`,
      });
      return { cliente, veiculo };
    }

    beforeAll(async () => {
      respostaDaMeta = { status: 200, corpo: { display_phone_number: '+55 11 3333-4444' } };
      expect((await conectar()).statusCode).toBe(200);
      await patch('/api/v1/messaging/templates', { key: 'VEHICLE_READY', status: 'APPROVED' });
      await patch('/api/v1/messaging/templates', { key: 'QUOTE_SENT', status: 'APPROVED' });
      // este bloco começa com tudo manual: o automático tem teste próprio
      await put('/api/v1/messaging/auto-send', { autoSend: [] });
      servicoId = (
        (await post('/api/v1/services', { name: 'Revisão completa', priceCents: 40_000 })).json() as { id: string }
      ).id;
    });

    it('"veículo pronto" sai pelo servidor, e a tela não tem link para abrir', async () => {
      const { cliente, veiculo } = await clienteComVeiculo('Nara Campos', '(11) 95555-0001');
      const { os } = await osPronta(cliente, veiculo.id);
      await post(`/api/v1/work-orders/${os.id}/complete`);
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: `wamid.${randomUUID()}` }] } };

      const res = await post(`/api/v1/work-orders/${os.id}/vehicle-ready`);
      expect(res.statusCode, res.body).toBe(200);
      const corpo = res.json() as { via: string; whatsappUrl: string | null; message: string };
      expect(corpo.via).toBe('API');
      expect(corpo.whatsappUrl, 'quem envia é o servidor: não há link para abrir').toBeNull();

      const enviado = chamadas.find((c) => c.method === 'POST')!.body as {
        type: string;
        template: { name: string; components: { parameters: { text: string }[] }[] };
      };
      expect(enviado.type, 'cliente que nunca escreveu: janela fechada, então vai por modelo').toBe('template');
      expect(enviado.template.name).toBe('vehicle_ready');
      expect(enviado.template.components[0]!.parameters.map((p) => semEspacoEstranho(p.text))).toEqual([
        'Nara',
        'Oficina Teste',
        'VW Gol',
        'R$ 400,00',
      ]);

      const fio = await conversa(cliente.id);
      expect(fio.messages, 'uma linha só no histórico, não duas').toHaveLength(1);
      expect(fio.messages[0]!.templateKey).toBe('VEHICLE_READY');
      expect(fio.messages[0]!.status).toBe('SENT');
    });

    it('com o automático ligado, finalizar a OS avisa o cliente sozinho', async () => {
      await put('/api/v1/messaging/auto-send', { autoSend: ['VEHICLE_READY'] });
      const { cliente, veiculo } = await clienteComVeiculo('Otávio Lins', '(11) 95555-0002');
      const { os } = await osPronta(cliente, veiculo.id);
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: `wamid.${randomUUID()}` }] } };

      await post(`/api/v1/work-orders/${os.id}/complete`);

      expect(chamadas.filter((c) => c.method === 'POST'), 'ninguém abriu tela nenhuma').toHaveLength(1);
      const fio = await conversa(cliente.id);
      expect(fio.messages[0]!.body).toContain('pronto para retirada');
    });

    it('com o automático desligado, finalizar a OS não manda nada', async () => {
      await put('/api/v1/messaging/auto-send', { autoSend: [] });
      const { cliente, veiculo } = await clienteComVeiculo('Paula Mota', '(11) 95555-0003');
      const { os } = await osPronta(cliente, veiculo.id);
      chamadas = [];

      await post(`/api/v1/work-orders/${os.id}/complete`);

      expect(chamadas.filter((c) => c.method === 'POST'), 'sem o interruptor, nada sai sozinho').toHaveLength(0);
      expect((await conversa(cliente.id)).messages).toHaveLength(0);
    });

    it('o orçamento enviado também sai pelo servidor', async () => {
      const { cliente, veiculo } = await clienteComVeiculo('Rui Barros', '(11) 95555-0004');
      const { orcamento } = await osPronta(cliente, veiculo.id);
      chamadas = [];
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: `wamid.${randomUUID()}` }] } };

      const res = await post(`/api/v1/quotes/${orcamento.id}/share`, { channel: 'WHATSAPP_LINK' });
      expect(res.statusCode, res.body).toBe(200);
      expect((res.json() as { via: string }).via).toBe('API');

      const enviado = chamadas.find((c) => c.method === 'POST')!.body as {
        template: { name: string; components: { parameters: { text: string }[] }[] };
      };
      expect(enviado.template.name).toBe('quote_sent');
      const variaveis = enviado.template.components[0]!.parameters.map((p) => p.text);
      expect(variaveis[0]).toBe('Rui');
      expect(semEspacoEstranho(variaveis[3]!), 'o valor do orçamento vai na mensagem').toBe('R$ 400,00');
      expect(variaveis[4], 'e o link do orçamento também').toContain('/orcamento/');
    });

    it('a Meta fora do ar não impede a OS de ser finalizada', async () => {
      await put('/api/v1/messaging/auto-send', { autoSend: ['VEHICLE_READY'] });
      const { cliente, veiculo } = await clienteComVeiculo('Sara Dias', '(11) 95555-0005');
      const { os } = await osPronta(cliente, veiculo.id);
      respostaDaMeta = { status: 500, corpo: { error: { message: 'Internal server error' } } };

      const res = await post(`/api/v1/work-orders/${os.id}/complete`);
      expect(res.statusCode, 'o carro está pronto mesmo que a mensagem não saia').toBe(200);
      expect((res.json() as { status: string }).status).toBe('COMPLETED');

      const fio = await conversa(cliente.id);
      expect(fio.messages[0]!.status, 'e a falha fica registrada, com o motivo').toBe('FAILED');
      expect(fio.messages[0]!.failureReason).toContain('Internal server error');
      await put('/api/v1/messaging/auto-send', { autoSend: [] });
      respostaDaMeta = { status: 200, corpo: { messages: [{ id: 'wamid.OK' }] } };
    });
  });

  // ------------------------------ desconectar -----------------------------

  it('desconectar apaga a credencial, e a mensagem volta a sair pelo link', async () => {
    // reconecta primeiro: o teste tem de provar o que ele diz mesmo rodando sozinho
    respostaDaMeta = { status: 200, corpo: { display_phone_number: '+55 11 3333-4444' } };
    expect((await conectar()).statusCode).toBe(200);

    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/v1/messaging/channel',
      headers: bearer(dono.accessToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as Visao).channel.status).toBe('DISCONNECTED');

    const linha = await canalNoBanco(dono.orgId);
    expect(linha.access_token_enc, 'desconectar tem de apagar o token, não só mudar o status').toBeNull();

    const cliente = await clienteComCarro('Lúcia Prado', '(11) 96666-0000');
    const envio = (await enviar(cliente.id, { body: 'oi' })).json() as Envio;
    expect(envio.via).toBe('LINK');
    expect(envio.whatsappUrl).toContain('wa.me');
  });
});
