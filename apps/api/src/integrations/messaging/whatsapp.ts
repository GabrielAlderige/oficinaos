import { createHmac, timingSafeEqual } from 'node:crypto';
import { telefoneParaApi, whatsappLink, type MessageStatus } from '@oficinaos/shared';

/**
 * WhatsApp atrás de uma interface (ARCHITECTURE §12), como o e-mail, o
 * storage, a nota e o gateway. Dois caminhos para a mesma mensagem:
 *
 *   LinkMessaging   o `wa.me` de sempre: devolve o link, e quem aperta enviar
 *                   é a pessoa da oficina. É o padrão, e continua valendo para
 *                   quem não conectou nada.
 *   CloudApiMessaging  a API oficial da Meta: a mensagem sai do servidor, e o
 *                   que o cliente responde volta pelo webhook.
 *
 * Nenhuma biblioteca não oficial, em nenhuma hipótese: número bloqueado é a
 * oficina sem o canal que ela usa para trabalhar.
 */

export interface MensagemParaEnviar {
  /** telefone do cliente, como está no cadastro */
  para: string;
  /** o texto já escrito pelo sistema (ou pela pessoa) */
  texto: string;
  /** quando a janela de 24 h está fechada, o envio precisa nomear o modelo */
  modelo?: { nome: string; idioma: string; variaveis: string[] } | null;
}

export interface EnvioFeito {
  /** o id da mensagem no WhatsApp: é por ele que "entregue" e "lido" voltam */
  providerMessageId: string | null;
  status: MessageStatus;
  /** quando o envio é por link, é para cá que a tela manda a pessoa */
  whatsappUrl: string | null;
  raw: Record<string, unknown>;
}

/** O que um aviso da Meta diz, já traduzido. */
export interface AvisoDeWhatsApp {
  /** o número da OFICINA que recebeu o aviso: diz de quem é a conversa */
  phoneNumberId: string;
  entradas: {
    /** telefone do cliente, só dígitos */
    de: string;
    texto: string;
    providerMessageId: string;
    quando: Date;
  }[];
  situacoes: {
    providerMessageId: string;
    status: MessageStatus;
    erro: string | null;
  }[];
}

export interface WhatsAppProvider {
  readonly driver: string;
  enviar(mensagem: MensagemParaEnviar): Promise<EnvioFeito>;
}

/** O caminho de sempre: o link com o texto pronto. */
export class LinkMessaging implements WhatsAppProvider {
  readonly driver = 'link';

  async enviar(mensagem: MensagemParaEnviar): Promise<EnvioFeito> {
    return {
      providerMessageId: null,
      // o máximo que se sabe do link é que a oficina o abriu; dizer "entregue"
      // sem a API seria mentira de tela
      status: 'LINK_OPENED',
      // o banco guarda E.164 (+55…), mas o telefone também chega de fora (o
      // fornecedor, um número digitado na hora): `telefoneParaApi` resolve os
      // dois sem virar `wa.me/55+55…`
      whatsappUrl: whatsappLink(telefoneParaApi(mensagem.para), mensagem.texto),
      raw: { via: 'wa.me' },
    };
  }
}

export interface CloudApiConfig {
  phoneNumberId: string;
  accessToken: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * WhatsApp Business Platform (Cloud API) da Meta.
 *
 * **Aviso honesto:** escrito a partir da documentação da API v21 e ainda **não
 * exercitado contra a API real** — falta uma conta conectada. O que está
 * provado são os testes de contrato (`whatsapp.test.ts`): o formato do envio,
 * a tradução do que volta, a leitura do aviso e a recusa de aviso sem
 * assinatura válida.
 */
export class CloudApiMessaging implements WhatsAppProvider {
  readonly driver = 'cloud-api';
  private readonly http: typeof fetch;
  private readonly base: string;

  constructor(private readonly config: CloudApiConfig) {
    this.http = config.fetch ?? fetch;
    this.base = config.baseUrl ?? 'https://graph.facebook.com/v21.0';
  }

  async enviar(mensagem: MensagemParaEnviar): Promise<EnvioFeito> {
    const corpo = mensagem.modelo
      ? {
          messaging_product: 'whatsapp',
          to: telefoneParaApi(mensagem.para),
          type: 'template',
          template: {
            name: mensagem.modelo.nome,
            language: { code: mensagem.modelo.idioma },
            components: mensagem.modelo.variaveis.length
              ? [
                  {
                    type: 'body',
                    parameters: mensagem.modelo.variaveis.map((valor) => ({ type: 'text', text: valor })),
                  },
                ]
              : [],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: telefoneParaApi(mensagem.para),
          type: 'text',
          text: { preview_url: true, body: mensagem.texto },
        };

    const resposta = await this.http(`${this.base}/${this.config.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.config.accessToken}`,
      },
      body: JSON.stringify(corpo),
    });
    const texto = await resposta.text();
    if (!resposta.ok) {
      throw new Error(`WhatsApp recusou o envio: ${mensagemDeErro(texto, resposta.status)}`);
    }
    const json = JSON.parse(texto || '{}') as { messages?: { id: string }[] };
    return {
      providerMessageId: json.messages?.[0]?.id ?? null,
      status: 'SENT',
      whatsappUrl: null,
      raw: json as unknown as Record<string, unknown>,
    };
  }
}

/** A mensagem legível que a Meta devolve; sobe para a tela do jeito que veio. */
function mensagemDeErro(texto: string, status: number): string {
  try {
    const json = JSON.parse(texto) as { error?: { message?: string; error_user_msg?: string } };
    return json.error?.error_user_msg || json.error?.message || `HTTP ${status}`;
  } catch {
    return texto || `HTTP ${status}`;
  }
}

/** Situação do WhatsApp → a nossa. O desconhecido nunca vira "entregue". */
export function statusDoWhatsApp(status: string): MessageStatus {
  switch (status) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'read':
      return 'READ';
    case 'failed':
      return 'FAILED';
    default:
      return 'SENT';
  }
}

/**
 * Confere a assinatura do aviso. A Meta assina o corpo CRU com o segredo do
 * app; comparar o corpo reserializado dá diferente por um espaço, e aviso sem
 * origem confiável é mensagem inventada.
 */
export function assinaturaConfere(corpoCru: string, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoCru).digest('hex');
  const recebido = cabecalho.slice('sha256='.length);
  const a = Buffer.from(esperado);
  const b = Buffer.from(recebido);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Lê o aviso da Meta: o que o cliente mandou e o que aconteceu com o que saiu. */
export function lerAviso(corpoCru: string): AvisoDeWhatsApp | null {
  const corpo = JSON.parse(corpoCru) as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }[];
          statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[];
        };
      }[];
    }[];
  };

  const valor = corpo.entry?.[0]?.changes?.[0]?.value;
  const phoneNumberId = valor?.metadata?.phone_number_id;
  if (!phoneNumberId) return null;

  return {
    phoneNumberId,
    entradas: (valor?.messages ?? [])
      // áudio, imagem e figurinha chegam sem texto: o histórico registra o que
      // dá para ler, e o resto continua no celular da oficina
      .filter((mensagem) => mensagem.type === 'text' && mensagem.text?.body && mensagem.from && mensagem.id)
      .map((mensagem) => ({
        de: mensagem.from!,
        texto: mensagem.text!.body!,
        providerMessageId: mensagem.id!,
        quando: mensagem.timestamp ? new Date(Number(mensagem.timestamp) * 1000) : new Date(),
      })),
    situacoes: (valor?.statuses ?? [])
      .filter((situacao) => situacao.id && situacao.status)
      .map((situacao) => ({
        providerMessageId: situacao.id!,
        status: statusDoWhatsApp(situacao.status!),
        erro: situacao.errors?.[0]?.message ?? situacao.errors?.[0]?.title ?? null,
      })),
  };
}
