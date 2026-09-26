import { createHmac } from 'node:crypto';
import {
  corpoDoModelo,
  ErrorCode,
  janelaAberta,
  MODELOS_DE_MENSAGEM,
  modeloPorChave,
  nomePadraoDoModelo,
  oQuePodeEnviar,
  respostasRapidas,
  whatsappLink,
  whatsappMaintenanceMessage,
  whatsappNoReturnMessage,
  whatsappPostSaleMessage,
  type ChatMessage,
  type ConnectChannelInput,
  type Conversation,
  type ConversationHelpers,
  type ConversationSummary,
  type MessageTemplateInfo,
  type MessageTemplateKey,
  type MessagingChannel,
  type MessageStatus,
  type MessagingOverview,
  type SendMessageInput,
  type SendMessageResult,
  type UpdateAutoSendInput,
  type UpdateTemplateInput,
} from '@oficinaos/shared';
import { recordActivity } from '../../core/audit';
import type { AuthContext, ClientInfo, ServiceDeps } from '../../core/auth-context';
import { AppError, notFound } from '../../core/errors';
import { cifrar, decifrar, dica } from '../../core/secrets';
import { withPhoneRef, withTenant, type Tx } from '../../db/tenant';
import {
  assinaturaConfere,
  CloudApiMessaging,
  lerAviso,
  LinkMessaging,
  type EnvioFeito,
  type WhatsAppProvider,
} from '../../integrations/messaging/whatsapp';
import * as customerRepo from '../customers/customers.repository';
import * as orgRepo from '../organizations/organizations.repository';
import * as repo from './messaging.repository';

/** O endereço que a oficina cola no painel da Meta. A API mora em /api do painel. */
const CAMINHO_DO_AVISO = '/api/v1/webhooks/whatsapp';

/**
 * Os modelos que a tela de conversa consegue escrever só com o cliente na
 * mão. Os outros (orçamento, cobrança, agendamento, avaliação) carregam um
 * link que nasce na tela deles, e é de lá que saem — oferecer aqui um botão
 * sem o link seria botão que não funciona.
 */
const MODELOS_DA_CONVERSA: MessageTemplateKey[] = ['POST_SALE', 'MAINTENANCE_DUE', 'NO_RETURN'];

/** Uma mensagem que nasceu em outra tela e quer sair pelo canal oficial. */
export interface EnvioDoSistema {
  customerId: string;
  telefone: string | null;
  templateKey: MessageTemplateKey;
  /** o texto que a tela de origem já escreveu (vale dentro da janela de 24 h) */
  texto: string;
  /** as variáveis do modelo, na ordem do catálogo (valem fora da janela) */
  variaveis: string[];
  workOrderId?: string | null;
  quoteId?: string | null;
  /** só sai se a oficina tiver ligado o automático para este modelo */
  somenteSeAutomatico?: boolean;
}

export interface ResultadoDoSistema {
  enviada: boolean;
  status: MessageStatus | null;
  /** por que saiu, ou por que não saiu — vai para o log e para a tela */
  motivo: string;
}

interface DadosDoCliente {
  id: string;
  name: string;
  telefone: string | null;
  veiculo: { make: string; model: string; plate: string | null } | null;
}

/**
 * WhatsApp oficial e conversa dentro do sistema (V3, E22).
 *
 * Cinco coisas que explicam o resto do arquivo:
 *
 * 1. **As credenciais são da oficina.** Cada uma cria a própria conta na Meta
 *    e cola aqui; o token fica cifrado (`core/secrets`) e nunca volta para a
 *    tela. Não conectar continua funcionando: a mensagem sai pelo link `wa.me`
 *    como sempre saiu.
 * 2. **A janela de 24 h manda.** Dentro dela, conversa normal em texto livre.
 *    Fora, a Meta só aceita modelo aprovado — e aí quem escreve o texto que o
 *    cliente lê é o modelo aprovado lá, não o nosso.
 * 3. **Pós-venda nunca sai sozinho.** Envio automático existe só para modelo
 *    de UTILIDADE, e por escolha explícita da oficina. Marketing disparado
 *    sozinho é o caminho curto para o número ser bloqueado — e aí a oficina
 *    perde o WhatsApp com que trabalha.
 * 4. **A chamada à Meta roda FORA da transação** (mesma razão da nota e do
 *    gateway): rede lenta não segura o banco.
 * 5. **O aviso da Meta é a única fonte de "entregue" e das respostas**, e só
 *    entra com a assinatura do corpo cru conferida.
 */
export class MessagingService {
  constructor(private readonly deps: ServiceDeps) {}

  // ============================== o canal ==================================

  async overview(auth: AuthContext): Promise<MessagingOverview> {
    return withTenant(this.deps.db, auth, (tx) => this.montarOverview(tx, auth.organizationId));
  }

  private async montarOverview(tx: Tx, organizationId: string): Promise<MessagingOverview> {
    const canal = await repo.findChannel(tx, organizationId);
    const linhas = await repo.listTemplates(tx, organizationId);

    const templates: MessageTemplateInfo[] = MODELOS_DE_MENSAGEM.map((modelo) => {
      const linha = linhas.find((l) => l.key === modelo.key);
      return {
        key: modelo.key,
        label: modelo.label,
        descricao: modelo.descricao,
        categoria: modelo.categoria,
        podeSerAutomatica: modelo.podeSerAutomatica,
        gatilho: modelo.gatilho,
        variaveis: modelo.variaveis,
        status: linha?.status ?? 'NOT_SUBMITTED',
        providerName: linha?.providerName ?? null,
        automatica: linha?.automatic ?? false,
        // o texto com {{1}}, {{2}}…: é isto que a oficina cola no painel da Meta
        exemplo: corpoDoModelo(modelo.key),
      };
    });

    return { channel: this.toChannelDto(organizationId, canal, templates), templates };
  }

  private toChannelDto(
    organizationId: string,
    canal: repo.ChannelRow | undefined,
    templates: MessageTemplateInfo[],
  ): MessagingChannel {
    return {
      provider: canal?.provider ?? 'LINK',
      status: canal?.status ?? 'DISCONNECTED',
      displayPhone: canal?.displayPhone ?? null,
      phoneNumberId: canal?.phoneNumberId ?? null,
      wabaId: canal?.wabaId ?? null,
      // só o fim do token: o suficiente para a pessoa ver que colou o certo
      tokenHint: canal?.accessTokenEnc ? dica(this.tokenDaOficina(canal)) : null,
      webhookUrl: `${this.deps.env.APP_URL}${CAMINHO_DO_AVISO}/${organizationId}`,
      verifyToken: this.tokenDeVerificacao(organizationId),
      connectedAt: canal?.connectedAt?.toISOString() ?? null,
      lastError: canal?.lastError ?? null,
      autoSend: templates.filter((t) => t.automatica).map((t) => t.key),
    };
  }

  /**
   * O token que a Meta repete na verificação do endereço. Derivado do segredo
   * do servidor, não sorteado: a verificação chega sem oficina no contexto, e
   * recalcular é mais simples (e menos frágil) do que ler o banco sem RLS.
   */
  private tokenDeVerificacao(organizationId: string): string {
    return createHmac('sha256', this.deps.env.JWT_SECRET)
      .update(`whatsapp:${organizationId}`)
      .digest('base64url')
      .slice(0, 32);
  }

  private tokenDaOficina(canal: repo.ChannelRow): string {
    if (!canal.accessTokenEnc) throw new AppError(422, ErrorCode.BAD_REQUEST, 'Canal sem credencial');
    return decifrar(canal.accessTokenEnc, this.deps.env.SECRETS_KEY);
  }

  /**
   * Conecta o WhatsApp da oficina. Antes de guardar nada, **usa** a credencial:
   * pergunta à Meta qual é o número daquele `phone_number_id`. Token errado
   * guardado com status "conectado" é a oficina descobrindo na primeira
   * mensagem que não sai nada.
   */
  async connect(auth: AuthContext, input: ConnectChannelInput, client: ClientInfo): Promise<MessagingOverview> {
    if (!this.deps.env.SECRETS_KEY) {
      throw new AppError(
        503,
        ErrorCode.INTERNAL,
        'Servidor sem chave de segredos',
        'Falta SECRETS_KEY no servidor: sem ela não dá para guardar o token da Meta com segurança. Fale com quem cuida do servidor.',
      );
    }

    const numero = await this.conferirCredencial(input);

    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.upsertChannel(tx, auth.organizationId, {
        provider: 'CLOUD_API',
        status: 'CONNECTED',
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId ?? null,
        displayPhone: numero,
        accessTokenEnc: cifrar(input.accessToken, this.deps.env.SECRETS_KEY),
        appSecretEnc: cifrar(input.appSecret, this.deps.env.SECRETS_KEY),
        verifyToken: this.tokenDeVerificacao(auth.organizationId),
        connectedAt: new Date(),
        lastError: null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'messaging.channel_connected',
        entityType: 'messaging_channel',
        entityId: auth.organizationId,
        // nunca o token, nem pedaço dele
        metadata: { phoneNumberId: input.phoneNumberId, displayPhone: numero },
        ...client,
      });
      return this.montarOverview(tx, auth.organizationId);
    });
  }

  /** Pergunta à Meta o número daquele id. Serve de teste da credencial. */
  private async conferirCredencial(input: ConnectChannelInput): Promise<string | null> {
    let resposta: Response;
    try {
      resposta = await fetch(
        `${this.deps.env.WHATSAPP_BASE_URL}/${input.phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { authorization: `Bearer ${input.accessToken}` } },
      );
    } catch {
      throw new AppError(
        502,
        ErrorCode.INTERNAL,
        'Não foi possível falar com a Meta',
        'A API do WhatsApp não respondeu agora. Tente de novo em alguns minutos.',
      );
    }
    const texto = await resposta.text();
    if (!resposta.ok) {
      let detalhe = `HTTP ${resposta.status}`;
      try {
        const json = JSON.parse(texto) as { error?: { message?: string } };
        detalhe = json.error?.message ?? detalhe;
      } catch {
        /* a Meta devolveu algo que não é JSON: o HTTP já diz o suficiente */
      }
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'A Meta não aceitou essas credenciais',
        `${detalhe}. Confira o id do número e o token no painel da Meta.`,
      );
    }
    const json = JSON.parse(texto || '{}') as { display_phone_number?: string };
    return json.display_phone_number ?? null;
  }

  async disconnect(auth: AuthContext, client: ClientInfo): Promise<MessagingOverview> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.upsertChannel(tx, auth.organizationId, {
        provider: 'LINK',
        status: 'DISCONNECTED',
        // a credencial sai do banco: desconectar tem de apagar o token, não só
        // mudar o status
        phoneNumberId: null,
        wabaId: null,
        displayPhone: null,
        accessTokenEnc: null,
        appSecretEnc: null,
        connectedAt: null,
        lastError: null,
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'messaging.channel_disconnected',
        entityType: 'messaging_channel',
        entityId: auth.organizationId,
        ...client,
      });
      return this.montarOverview(tx, auth.organizationId);
    });
  }

  /** O que a oficina informou sobre o modelo na Meta (situação e nome de lá). */
  async saveTemplate(auth: AuthContext, input: UpdateTemplateInput): Promise<MessagingOverview> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.upsertTemplate(tx, auth.organizationId, input.key, {
        ...(input.status ? { status: input.status } : {}),
        ...(input.providerName !== undefined ? { providerName: input.providerName } : {}),
      });
      return this.montarOverview(tx, auth.organizationId);
    });
  }

  /**
   * Liga o envio automático, modelo por modelo. Só os de UTILIDADE entram:
   * pedir automático para pós-venda é pedir para o número ser bloqueado, e a
   * recusa aqui é regra do produto, não checagem de formulário.
   */
  async setAutoSend(auth: AuthContext, input: UpdateAutoSendInput, client: ClientInfo): Promise<MessagingOverview> {
    const proibido = input.autoSend.find((key) => {
      const modelo = modeloPorChave(key);
      // duas recusas diferentes: marketing NUNCA pode (D51), e utilidade sem
      // gatilho ligado ainda não tem evento que a dispare
      return !modelo?.podeSerAutomatica || !modelo.gatilho;
    });
    if (proibido) {
      const modelo = modeloPorChave(proibido);
      throw new AppError(
        422,
        ErrorCode.VALIDATION_FAILED,
        'Esse modelo não pode sair sozinho',
        modelo?.podeSerAutomatica
          ? `"${modelo.label}" ainda não tem envio automático: ela sai da tela dela, quando você manda.`
          : `"${modelo?.label}" é mensagem de reengajamento: ela sempre espera alguém apertar enviar.`,
      );
    }

    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await repo.listTemplates(tx, auth.organizationId);
      for (const modelo of MODELOS_DE_MENSAGEM) {
        const automatic = input.autoSend.includes(modelo.key);
        const linha = linhas.find((l) => l.key === modelo.key);
        if ((linha?.automatic ?? false) === automatic) continue;
        await repo.upsertTemplate(tx, auth.organizationId, modelo.key, { automatic });
      }
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'messaging.auto_send_changed',
        entityType: 'messaging_channel',
        entityId: auth.organizationId,
        metadata: { autoSend: input.autoSend },
        ...client,
      });
      return this.montarOverview(tx, auth.organizationId);
    });
  }

  // ============================ a conversa =================================

  async conversations(auth: AuthContext): Promise<ConversationSummary[]> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const linhas = await repo.listConversations(tx, auth.organizationId);
      return linhas.map((linha) => ({
        customerId: linha.conversa.customerId,
        customerName: linha.customerName,
        phone: linha.phone ?? linha.phone2 ?? null,
        lastMessageAt: linha.conversa.lastMessageAt?.toISOString() ?? null,
        lastPreview: linha.conversa.lastPreview ?? null,
        lastDirection: (linha.conversa.lastDirection as 'INBOUND' | 'OUTBOUND' | null) ?? null,
        unread: linha.conversa.unread,
        windowOpen: janelaAberta(linha.conversa.lastInboundAt),
      }));
    });
  }

  async conversation(auth: AuthContext, customerId: string): Promise<Conversation> {
    return withTenant(this.deps.db, auth, (tx) => this.montarConversa(tx, auth.organizationId, customerId));
  }

  private async montarConversa(tx: Tx, organizationId: string, customerId: string): Promise<Conversation> {
    const cliente = await this.lerCliente(tx, organizationId, customerId);
    const canal = await repo.findChannel(tx, organizationId);
    const conversa = await repo.findConversation(tx, organizationId, customerId);
    const conectado = canal?.status === 'CONNECTED';
    const janela = oQuePodeEnviar({ canalConectado: conectado, ultimaEntradaEm: conversa?.lastInboundAt ?? null });
    const linhas = await repo.listMessages(tx, organizationId, customerId);

    return {
      customerId,
      customerName: cliente.name,
      phone: cliente.telefone,
      channelConnected: conectado,
      canSendFreeText: janela.textoLivre,
      onlyTemplate: janela.somenteModelo,
      windowReason: janela.motivo,
      whatsappUrl: cliente.telefone ? whatsappLink(cliente.telefone, '') : null,
      // o banco devolve do mais novo para o mais velho (é o índice); a tela lê
      // de cima para baixo
      messages: linhas.reverse().map((linha) => this.toMessageDto(linha)),
    };
  }

  private toMessageDto(linha: Awaited<ReturnType<typeof repo.listMessages>>[number]): ChatMessage {
    const { mensagem } = linha;
    return {
      id: mensagem.id,
      direction: mensagem.direction,
      body: mensagem.body,
      status: mensagem.status,
      templateKey: (mensagem.templateKey as MessageTemplateKey | null) ?? null,
      sentByName: linha.sentByName ?? null,
      failureReason: mensagem.failureReason ?? null,
      createdAt: mensagem.createdAt.toISOString(),
    };
  }

  async markRead(auth: AuthContext, customerId: string): Promise<Conversation> {
    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.clearUnread(tx, auth.organizationId, customerId);
      return this.montarConversa(tx, auth.organizationId, customerId);
    });
  }

  /**
   * O que a tela de conversa oferece com um toque, já escrito com o nome e o
   * carro do cliente: os **modelos** (que a Meta entrega até fora da janela de
   * 24 h, quando aprovados) e as **respostas rápidas**, que só preenchem o
   * campo de texto. Nos dois casos, nada sai antes de alguém apertar enviar.
   */
  async previews(auth: AuthContext, customerId: string): Promise<ConversationHelpers> {
    return withTenant(this.deps.db, auth, async (tx) => {
      const cliente = await this.lerCliente(tx, auth.organizationId, customerId);
      const canal = await repo.findChannel(tx, auth.organizationId);
      const conversa = await repo.findConversation(tx, auth.organizationId, customerId);
      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const modelos = await repo.listTemplates(tx, auth.organizationId);
      const conectado = canal?.status === 'CONNECTED';
      const aberta = janelaAberta(conversa?.lastInboundAt ?? null);

      const nomeDaOficina = oficina?.name ?? 'Oficina';
      return {
        templates: MODELOS_DA_CONVERSA.map((key) => {
          const texto = this.escrever(key, cliente, nomeDaOficina);
          const situacao = modelos.find((m) => m.key === key)?.status ?? 'NOT_SUBMITTED';
          return {
            templateKey: key,
            body: texto,
            via: conectado ? ('CLOUD_API' as const) : ('LINK' as const),
            whatsappUrl: !conectado && cliente.telefone ? whatsappLink(cliente.telefone, texto) : null,
            blocker: this.oQueImpede({ conectado, aberta, situacao, telefone: cliente.telefone, key }),
          };
        }),
        quickReplies: respostasRapidas({
          cliente: cliente.name.trim().split(/\s+/)[0] ?? cliente.name,
          oficina: nomeDaOficina,
          veiculo: cliente.veiculo ? `${cliente.veiculo.make} ${cliente.veiculo.model}` : 'carro',
        }),
      };
    });
  }

  /** O que impede o envio agora, em uma frase que a pessoa consegue resolver. */
  private oQueImpede(input: {
    conectado: boolean;
    aberta: boolean;
    situacao: string;
    telefone: string | null;
    key: MessageTemplateKey;
  }): string | null {
    if (!input.telefone) return 'Este cliente não tem WhatsApp no cadastro.';
    if (!input.conectado || input.aberta) return null;
    if (input.situacao !== 'APPROVED') {
      return `Faz mais de 24 h que o cliente não escreve, e o modelo "${modeloPorChave(input.key)?.label}" ainda não está aprovado na Meta. Dá para enviar pelo link do WhatsApp.`;
    }
    return null;
  }

  /** O texto do modelo com os dados de verdade do cliente. */
  private escrever(key: MessageTemplateKey, cliente: DadosDoCliente, oficina: string): string {
    if (key === 'MAINTENANCE_DUE') {
      return whatsappMaintenanceMessage({
        customerName: cliente.name,
        shopName: oficina,
        vehicle: cliente.veiculo,
        serviceName: 'Revisão',
        quando: 'em breve',
      });
    }
    if (key === 'NO_RETURN') {
      return whatsappNoReturnMessage({ customerName: cliente.name, shopName: oficina, vehicle: cliente.veiculo });
    }
    return whatsappPostSaleMessage({
      customerName: cliente.name,
      shopName: oficina,
      vehicle: cliente.veiculo,
      serviceName: null,
    });
  }

  /** As variáveis do modelo, na ordem do catálogo (é o que a Meta espera). */
  private variaveis(key: MessageTemplateKey, cliente: DadosDoCliente, oficina: string): string[] {
    const primeiroNome = cliente.name.trim().split(/\s+/)[0] ?? cliente.name;
    const carro = cliente.veiculo ? `${cliente.veiculo.make} ${cliente.veiculo.model}` : 'carro';
    if (key === 'MAINTENANCE_DUE') return [primeiroNome, oficina, carro, 'vence em breve'];
    return [primeiroNome, oficina, carro];
  }

  private async lerCliente(tx: Tx, organizationId: string, customerId: string): Promise<DadosDoCliente> {
    const encontrado = await customerRepo.findCustomer(tx, organizationId, customerId);
    if (!encontrado) throw notFound('Cliente não encontrado.');
    const { customer: cliente } = encontrado;
    const veiculo = await repo.lastVehicle(tx, organizationId, customerId);
    return {
      id: cliente.id,
      name: cliente.name,
      telefone: cliente.whatsapp ?? cliente.phone ?? null,
      veiculo: veiculo ? { make: veiculo.make, model: veiculo.model, plate: veiculo.plate } : null,
    };
  }

  // ============================== o envio ==================================

  /**
   * Manda a mensagem. Texto livre só com a janela aberta; fora dela, modelo
   * aprovado. Sem canal conectado, devolve o link `wa.me` com o texto pronto —
   * é o que o sistema sempre fez, e continua valendo.
   */
  async send(
    auth: AuthContext,
    customerId: string,
    input: SendMessageInput,
    client: ClientInfo,
  ): Promise<SendMessageResult> {
    const preparo = await withTenant(this.deps.db, auth, async (tx) => {
      const repetida = await repo.findByClientRequest(tx, auth.organizationId, input.clientRequestId);
      if (repetida) return { repetida: true as const };

      const cliente = await this.lerCliente(tx, auth.organizationId, customerId);
      if (!cliente.telefone) {
        throw new AppError(
          422,
          ErrorCode.CUSTOMER_WITHOUT_WHATSAPP,
          'Cliente sem WhatsApp',
          'Cadastre o WhatsApp do cliente para conversar por aqui.',
        );
      }
      const canal = await repo.findChannel(tx, auth.organizationId);
      const conversa = await repo.findConversation(tx, auth.organizationId, customerId);
      const oficina = await orgRepo.findOrganization(tx, auth.organizationId);
      const modelo = input.templateKey
        ? (await repo.listTemplates(tx, auth.organizationId)).find((m) => m.key === input.templateKey)
        : undefined;
      return {
        repetida: false as const,
        cliente,
        canal,
        oficina: oficina?.name ?? 'Oficina',
        aberta: janelaAberta(conversa?.lastInboundAt ?? null),
        situacao: modelo?.status ?? 'NOT_SUBMITTED',
        nomeNaMeta: input.templateKey ? (modelo?.providerName ?? nomePadraoDoModelo(input.templateKey)) : null,
      };
    });

    // POST repetido pela rede: a mensagem não sai de novo (D32)
    if (preparo.repetida) {
      return {
        conversation: await this.conversation(auth, customerId),
        whatsappUrl: null,
        via: 'LINK',
        repeated: true,
      };
    }

    const { cliente, canal, oficina, aberta, situacao, nomeNaMeta } = preparo;
    const conectado = canal?.status === 'CONNECTED';
    const texto = input.body ?? this.escrever(input.templateKey!, cliente, oficina);

    if (conectado && !aberta && !input.templateKey) {
      throw new AppError(
        422,
        ErrorCode.WHATSAPP_WINDOW_CLOSED,
        'A janela de conversa fechou',
        'Faz mais de 24 h que o cliente não escreve: a Meta só aceita um modelo aprovado agora.',
      );
    }
    if (conectado && !aberta && input.templateKey && situacao !== 'APPROVED') {
      throw new AppError(
        422,
        ErrorCode.WHATSAPP_TEMPLATE_NOT_APPROVED,
        'Modelo ainda não aprovado',
        `Fora da janela de 24 h a Meta só entrega modelo aprovado, e "${modeloPorChave(input.templateKey)?.label}" ainda não está. Dá para enviar pelo link do WhatsApp.`,
      );
    }

    const provider: WhatsAppProvider = conectado && canal ? this.provider(canal) : new LinkMessaging();
    // fora da transação: rede lenta não segura o banco
    let envio: EnvioFeito;
    try {
      envio = await provider.enviar({
        para: cliente.telefone!,
        texto,
        // dentro da janela, texto livre não depende de aprovação nenhuma; fora
        // dela, só o modelo passa
        modelo:
          conectado && !aberta && input.templateKey
            ? { nome: nomeNaMeta!, idioma: 'pt_BR', variaveis: this.variaveis(input.templateKey, cliente, oficina) }
            : null,
      });
    } catch (erro) {
      await this.guardarFalha(auth, cliente, input, texto, erro);
      throw new AppError(
        502,
        ErrorCode.WHATSAPP_SEND_FAILED,
        'O WhatsApp não aceitou a mensagem',
        erro instanceof Error ? erro.message : 'Erro desconhecido ao falar com a Meta.',
      );
    }

    return withTenant(this.deps.db, auth, async (tx) => {
      await repo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId,
        channel: conectado ? 'WHATSAPP_API' : 'WHATSAPP_LINK',
        direction: 'OUTBOUND',
        templateKey: input.templateKey ?? null,
        body: texto,
        toAddress: cliente.telefone,
        workOrderId: input.workOrderId ?? null,
        status: envio.status,
        providerMessageId: envio.providerMessageId,
        clientRequestId: input.clientRequestId,
        sentBy: auth.userId,
      });
      await repo.upsertConversation(tx, auth.organizationId, customerId, {
        lastMessageAt: new Date(),
        lastPreview: texto.slice(0, 160),
        lastDirection: 'OUTBOUND',
      });
      await recordActivity(tx, {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: 'message.sent',
        entityType: 'customer',
        entityId: customerId,
        metadata: { via: conectado ? 'CLOUD_API' : 'LINK', templateKey: input.templateKey ?? null },
        ...client,
      });
      return {
        conversation: await this.montarConversa(tx, auth.organizationId, customerId),
        whatsappUrl: envio.whatsappUrl,
        via: conectado ? ('CLOUD_API' as const) : ('LINK' as const),
        repeated: false,
      };
    });
  }

  /**
   * Envio recusado pela Meta fica registrado, com o motivo dela. Sem isto, a
   * oficina vê a mensagem "sumir" e não tem onde olhar.
   */
  private async guardarFalha(
    auth: AuthContext,
    cliente: DadosDoCliente,
    input: SendMessageInput,
    texto: string,
    erro: unknown,
  ): Promise<void> {
    const motivo = erro instanceof Error ? erro.message.slice(0, 500) : 'erro desconhecido';
    try {
      await withTenant(this.deps.db, auth, async (tx) => {
        await repo.insertMessage(tx, {
          organizationId: auth.organizationId,
          customerId: cliente.id,
          channel: 'WHATSAPP_API',
          direction: 'OUTBOUND',
          templateKey: input.templateKey ?? null,
          body: texto,
          toAddress: cliente.telefone,
          status: 'FAILED',
          failureReason: motivo,
          clientRequestId: input.clientRequestId,
          sentBy: auth.userId,
        });
        await repo.upsertChannel(tx, auth.organizationId, { lastError: motivo });
      });
    } catch (falha) {
      // o erro que interessa é o da Meta; este vai para o log e não o substitui
      this.deps.log.error({ err: falha }, 'não foi possível registrar a falha de envio');
    }
  }

  private provider(canal: repo.ChannelRow): WhatsAppProvider {
    return new CloudApiMessaging({
      phoneNumberId: canal.phoneNumberId!,
      accessToken: this.tokenDaOficina(canal),
      baseUrl: this.deps.env.WHATSAPP_BASE_URL,
    });
  }

  // ====================== mensagem nascida no sistema ======================

  /**
   * O aviso que nasce em outra tela (orçamento enviado, veículo pronto) indo
   * pelo canal oficial. Quem chama já escreveu o texto — este método só decide
   * se dá para enviar pela API e registra o que aconteceu.
   *
   * Devolve `enviada: false` sempre que não der (sem canal, sem telefone,
   * janela fechada com modelo não aprovado, automático desligado, ou a Meta
   * recusando): aí quem chamou segue com o link `wa.me` de sempre. Nunca
   * estoura — o trabalho de quem chamou (marcar a OS pronta, enviar o
   * orçamento) não pode falhar por causa da mensagem.
   */
  async enviarDoSistema(auth: AuthContext, input: EnvioDoSistema): Promise<ResultadoDoSistema> {
    const preparo = await withTenant(this.deps.db, auth, async (tx) => {
      const canal = await repo.findChannel(tx, auth.organizationId);
      const conversa = await repo.findConversation(tx, auth.organizationId, input.customerId);
      const modelo = (await repo.listTemplates(tx, auth.organizationId)).find((m) => m.key === input.templateKey);
      return {
        canal,
        aberta: janelaAberta(conversa?.lastInboundAt ?? null),
        automatica: modelo?.automatic ?? false,
        aprovado: modelo?.status === 'APPROVED',
        nomeNaMeta: modelo?.providerName ?? nomePadraoDoModelo(input.templateKey),
      };
    });

    const { canal, aberta, automatica, aprovado, nomeNaMeta } = preparo;
    if (canal?.status !== 'CONNECTED') return { enviada: false, status: null, motivo: 'canal não conectado' };
    if (input.somenteSeAutomatico && !automatica) {
      return { enviada: false, status: null, motivo: 'envio automático desligado' };
    }
    if (!input.telefone) return { enviada: false, status: null, motivo: 'cliente sem WhatsApp' };
    if (!aberta && !aprovado) {
      return { enviada: false, status: null, motivo: 'fora da janela de 24 h e o modelo não está aprovado' };
    }

    let envio: EnvioFeito;
    try {
      envio = await this.provider(canal).enviar({
        para: input.telefone,
        texto: input.texto,
        modelo: aberta ? null : { nome: nomeNaMeta, idioma: 'pt_BR', variaveis: input.variaveis },
      });
    } catch (erro) {
      const motivo = erro instanceof Error ? erro.message.slice(0, 500) : 'erro desconhecido';
      await withTenant(this.deps.db, auth, async (tx) => {
        await repo.insertMessage(tx, {
          organizationId: auth.organizationId,
          customerId: input.customerId,
          channel: 'WHATSAPP_API',
          direction: 'OUTBOUND',
          templateKey: input.templateKey,
          body: input.texto,
          toAddress: input.telefone,
          workOrderId: input.workOrderId ?? null,
          quoteId: input.quoteId ?? null,
          status: 'FAILED',
          failureReason: motivo,
          sentBy: auth.userId,
        });
        await repo.upsertChannel(tx, auth.organizationId, { lastError: motivo });
      });
      this.deps.log.warn({ err: erro, templateKey: input.templateKey }, 'whatsapp recusou a mensagem do sistema');
      return { enviada: false, status: 'FAILED', motivo };
    }

    await withTenant(this.deps.db, auth, async (tx) => {
      await repo.insertMessage(tx, {
        organizationId: auth.organizationId,
        customerId: input.customerId,
        channel: 'WHATSAPP_API',
        direction: 'OUTBOUND',
        templateKey: input.templateKey,
        body: input.texto,
        toAddress: input.telefone,
        workOrderId: input.workOrderId ?? null,
        quoteId: input.quoteId ?? null,
        status: envio.status,
        providerMessageId: envio.providerMessageId,
        sentBy: auth.userId,
      });
      await repo.upsertConversation(tx, auth.organizationId, input.customerId, {
        lastMessageAt: new Date(),
        lastPreview: input.texto.slice(0, 160),
        lastDirection: 'OUTBOUND',
      });
    });

    return { enviada: true, status: envio.status, motivo: aberta ? 'texto livre' : 'modelo aprovado' };
  }

  // ============================== o aviso ==================================

  /**
   * A verificação do endereço, que a Meta faz uma vez com um GET. Devolve o
   * desafio quando o token combina; nada de banco no caminho.
   */
  verificarEndereco(organizationId: string, query: { mode?: string; token?: string; challenge?: string }): string {
    const esperado = this.tokenDeVerificacao(organizationId);
    if (query.mode !== 'subscribe' || query.token !== esperado || !query.challenge) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Verificação recusada');
    }
    return query.challenge;
  }

  /**
   * O aviso da Meta: o que o cliente respondeu e o que aconteceu com o que
   * saiu. Só entra com a assinatura do corpo CRU conferida contra o segredo do
   * app daquela oficina.
   */
  async handleWebhook(
    organizationId: string,
    rawBody: string,
    assinatura: string | undefined,
  ): Promise<{ handled: boolean; reason: string }> {
    let aviso: ReturnType<typeof lerAviso>;
    try {
      aviso = lerAviso(rawBody);
    } catch {
      return { handled: false, reason: 'corpo ilegível' };
    }
    if (!aviso) return { handled: false, reason: 'evento ignorado' };
    const recado = aviso;

    // sem oficina no contexto: quem diz de quem é a conversa é o id do número
    const canal = await withPhoneRef(this.deps.db, recado.phoneNumberId, (tx) =>
      repo.findChannelByPhoneId(tx, recado.phoneNumberId),
    );
    if (!canal) return { handled: false, reason: 'número não conectado' };
    if (canal.organizationId !== organizationId) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'Aviso de outra oficina');
    }
    if (!canal.appSecretEnc) return { handled: false, reason: 'canal sem segredo do app' };
    if (!assinaturaConfere(rawBody, assinatura, decifrar(canal.appSecretEnc, this.deps.env.SECRETS_KEY))) {
      throw new AppError(401, ErrorCode.UNAUTHORIZED, 'Assinatura inválida');
    }

    let novas = 0;
    let situacoes = 0;
    let semCadastro = 0;

    await withTenant(this.deps.db, { organizationId: canal.organizationId }, async (tx) => {
      for (const entrada of recado.entradas) {
        // o mesmo aviso chega duas vezes quando a Meta não recebe o 200
        if (await repo.findByProviderId(tx, canal.organizationId, entrada.providerMessageId)) continue;

        const cliente = await repo.findCustomerByPhone(tx, canal.organizationId, entrada.de);
        await repo.insertMessage(tx, {
          organizationId: canal.organizationId,
          customerId: cliente?.id ?? null,
          channel: 'WHATSAPP_API',
          direction: 'INBOUND',
          body: entrada.texto,
          toAddress: entrada.de,
          status: 'DELIVERED',
          providerMessageId: entrada.providerMessageId,
          createdAt: entrada.quando,
        });
        if (!cliente) {
          // mensagem de número fora do cadastro não se perde: fica no histórico
          // da oficina, só sem conversa para abrir
          semCadastro += 1;
          continue;
        }
        await repo.upsertConversation(tx, canal.organizationId, cliente.id, {
          lastMessageAt: entrada.quando,
          lastInboundAt: entrada.quando,
          lastPreview: entrada.texto.slice(0, 160),
          lastDirection: 'INBOUND',
        });
        await repo.bumpUnread(tx, canal.organizationId, cliente.id);
        novas += 1;
      }

      for (const situacao of recado.situacoes) {
        const nossa = await repo.updateStatusByProviderId(tx, canal.organizationId, situacao.providerMessageId, {
          status: situacao.status,
          failureReason: situacao.erro,
        });
        if (nossa) situacoes += 1;
      }
    });

    return {
      handled: novas + situacoes + semCadastro > 0,
      reason: `${novas} nova(s), ${situacoes} situação(ões), ${semCadastro} sem cadastro`,
    };
  }
}
