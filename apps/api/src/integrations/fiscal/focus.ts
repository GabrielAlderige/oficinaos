import type { NfseProvider, PedidoDeNfse, RespostaDeCancelamento, RespostaDoEmissor } from './nfse';

/**
 * Focus NFe, NFS-e no **padrão nacional** (`/v2/nfsen`). Desde janeiro de 2026
 * todo município tem de aceitar o padrão nacional (LC 214/2025), então um
 * formato só serve para todas as cidades: é por isso que não usamos o
 * `/v2/nfse` municipal, que muda de prefeitura para prefeitura.
 *
 * Como a Focus funciona, e o que isso explica aqui:
 * - cada oficina é uma "empresa" na conta do OficinaOS, com **o próprio
 *   token** (um de homologação, outro de produção). O token chega cifrado do
 *   banco e é decifrado só na hora de chamar;
 * - autenticação é HTTP Basic com o token como usuário e a senha **vazia**;
 * - a emissão é **assíncrona**: o POST responde `processando_autorizacao` e a
 *   nota sai depois, por consulta (`GET /v2/nfsen/{ref}`);
 * - a referência (`ref`) é o id da nossa nota. Reenviar a mesma referência dá
 *   "Já existe um DPS com esta referência": aí a nota já está lá, e o certo é
 *   consultar, nunca emitir de novo.
 *
 * Documentação: https://doc.focusnfe.com.br/reference/emitir_dps_nacional
 */

const BASE = {
  HOMOLOGATION: 'https://homologacao.focusnfe.com.br',
  PRODUCTION: 'https://api.focusnfe.com.br',
} as const;

export interface OpcoesFocus {
  token: string;
  environment: keyof typeof BASE;
  fetch?: typeof fetch;
  agora?: () => Date;
}

type Corpo = Record<string, unknown>;

const reais = (centavos: number) => Math.round(centavos) / 100;
const digitos = (valor: string | null | undefined) => (valor ?? '').replace(/\D/g, '');

/** 14.01 (item da LC 116) vira 140101: item, subitem e o desdobramento "01". */
export function codigoTributacaoNacional(pedido: PedidoDeNfse): string {
  const informado = digitos(pedido.prestador.nationalServiceCode);
  if (informado.length === 6) return informado;
  const [item = '', subitem = ''] = (pedido.prestador.serviceListItem || '14.01').split('.');
  return `${item.padStart(2, '0')}${subitem.padStart(2, '0')}01`;
}

/** Situação no Simples: 1 não optante, 2 MEI, 3 ME/EPP. */
export function opcaoSimples(regime: string): number {
  if (regime === 'MEI') return 2;
  if (regime === 'SIMPLES_NACIONAL') return 3;
  return 1;
}

/** Data e hora no relógio de Brasília (sem horário de verão desde 2019). */
function noBrasil(data: Date): { dia: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? '00';
  return { dia: `${p('year')}-${p('month')}-${p('day')}`, hora: `${p('hour')}:${p('minute')}:${p('second')}` };
}

/** O JSON que a Focus espera, campo a campo como na documentação deles. */
export function montarDps(pedido: PedidoDeNfse, agora: Date): Corpo {
  const { prestador, tomador, valores } = pedido;
  const { dia, hora } = noBrasil(agora);
  const ibge = Number(digitos(prestador.ibgeCityCode));
  const docPrestador = digitos(prestador.document);
  const opcao = opcaoSimples(prestador.taxRegime);

  const corpo: Corpo = {
    data_emissao: `${dia}T${hora}-03:00`,
    data_competencia: dia,
    serie_dps: Number(digitos(pedido.rpsSeries)) || 1,
    numero_dps: pedido.rpsNumber,
    emitente_dps: 1,
    codigo_municipio_emissora: ibge,
    [docPrestador.length === 11 ? 'cpf_prestador' : 'cnpj_prestador']: docPrestador,
    codigo_opcao_simples_nacional: opcao,
    codigo_municipio_prestacao: String(ibge),
    codigo_tributacao_nacional_iss: codigoTributacaoNacional(pedido),
    descricao_servico: pedido.discriminacao.slice(0, 2000),
    valor_servico: reais(valores.serviceAmountCents),
    tributacao_iss: 1,
    tipo_retencao_iss: valores.issRetained ? 2 : 1,
  };
  // ME/EPP precisa dizer como apura: tudo dentro do Simples é o caso da oficina
  if (opcao === 3) corpo.regime_tributario_simples_nacional = 1;
  if (prestador.municipalRegistration) corpo.inscricao_municipal_prestador = digitos(prestador.municipalRegistration);
  if (prestador.municipalServiceCode) corpo.codigo_tributacao_municipal_iss = prestador.municipalServiceCode;
  if (valores.discountCents > 0) corpo.desconto_incondicionado = reais(valores.discountCents);
  if (valores.irrfCents > 0) corpo.valor_irrf = reais(valores.irrfCents);

  // tomador sem CPF/CNPJ vai como não identificado: o padrão nacional aceita,
  // e inventar documento para "preencher" seria nota errada
  const docTomador = digitos(tomador.document);
  if (docTomador.length === 11 || docTomador.length === 14) {
    corpo[docTomador.length === 11 ? 'cpf_tomador' : 'cnpj_tomador'] = docTomador;
    corpo.razao_social_tomador = tomador.name;
    if (tomador.email) corpo.email_tomador = tomador.email;
    if (tomador.zip) corpo.cep_tomador = digitos(tomador.zip);
    if (tomador.street) corpo.logradouro_tomador = tomador.street;
    if (tomador.number) corpo.numero_tomador = tomador.number;
    if (tomador.complement) corpo.complemento_tomador = tomador.complement;
    if (tomador.district) corpo.bairro_tomador = tomador.district;
  }
  return corpo;
}

/** "mensagem (correção)" de cada erro, numa linha só que a oficina consegue ler. */
function errosLegiveis(corpo: Corpo): string {
  const erros = Array.isArray(corpo.erros) ? (corpo.erros as Corpo[]) : [];
  const linhas = erros.map((e) => [e.mensagem, e.correcao ? `(${String(e.correcao)})` : ''].filter(Boolean).join(' '));
  if (!linhas.length && corpo.mensagem) linhas.push(String(corpo.mensagem));
  return linhas.join(' · ') || 'A prefeitura recusou a nota sem dizer o motivo.';
}

export class FocusNfseProvider implements NfseProvider {
  readonly driver = 'focus';
  readonly environment;
  private readonly base: string;
  private readonly http: typeof fetch;
  private readonly agora: () => Date;
  private readonly autorizacao: string;

  constructor(opcoes: OpcoesFocus) {
    this.environment = opcoes.environment;
    this.base = BASE[opcoes.environment];
    this.http = opcoes.fetch ?? fetch;
    this.agora = opcoes.agora ?? (() => new Date());
    this.autorizacao = `Basic ${Buffer.from(`${opcoes.token}:`).toString('base64')}`;
  }

  private async chamar(metodo: string, caminho: string, corpo?: Corpo): Promise<{ status: number; json: Corpo }> {
    const resposta = await this.http(`${this.base}${caminho}`, {
      method: metodo,
      headers: { authorization: this.autorizacao, 'content-type': 'application/json', accept: 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await resposta.text();
    let json: Corpo = {};
    try {
      json = texto ? (JSON.parse(texto) as Corpo) : {};
    } catch {
      json = { mensagem: texto.slice(0, 300) };
    }
    return { status: resposta.status, json };
  }

  private resposta(ref: string, status: RespostaDoEmissor['status'], json: Corpo, extra: Partial<RespostaDoEmissor> = {}): RespostaDoEmissor {
    return {
      status,
      environment: this.environment,
      provider: this.driver,
      providerRef: ref,
      invoiceNumber: null,
      verificationCode: null,
      publicUrl: null,
      pdfUrl: null,
      xmlUrl: null,
      issuedAt: null,
      rejectionReason: null,
      raw: json,
      ...extra,
    };
  }

  async emitir(pedido: PedidoDeNfse): Promise<RespostaDoEmissor> {
    const ref = pedido.invoiceId;
    const { status, json } = await this.chamar('POST', `/v2/nfsen?ref=${encodeURIComponent(ref)}`, montarDps(pedido, this.agora()));
    if (status === 401 || status === 403) {
      return this.resposta(ref, 'REJECTED', json, {
        rejectionReason: 'O emissor recusou a credencial desta oficina. Fale com o suporte do OficinaOS.',
      });
    }
    if (status >= 500) throw new Error(`Focus NFe respondeu ${status}`);
    if (status === 422 && /j[aá] existe/i.test(String(json.mensagem ?? ''))) {
      // a nota já tinha chegado lá (resposta perdida no caminho): consulta
      return this.consultar({ providerRef: ref, invoiceId: ref });
    }
    if (status >= 400) return this.resposta(ref, 'REJECTED', json, { rejectionReason: errosLegiveis(json) });
    return this.traduzir(ref, json);
  }

  async consultar(input: { providerRef: string | null; invoiceId: string }): Promise<RespostaDoEmissor> {
    const ref = input.providerRef ?? input.invoiceId;
    const { status, json } = await this.chamar('GET', `/v2/nfsen/${encodeURIComponent(ref)}`);
    if (status >= 500) throw new Error(`Focus NFe respondeu ${status}`);
    if (status === 404) {
      return this.resposta(ref, 'REJECTED', json, { rejectionReason: 'O emissor não encontrou esta nota. Emita de novo.' });
    }
    return this.traduzir(ref, json);
  }

  private traduzir(ref: string, json: Corpo): RespostaDoEmissor {
    switch (json.status) {
      case 'autorizado':
        return this.resposta(ref, 'AUTHORIZED', json, {
          invoiceNumber: json.numero ? String(json.numero) : null,
          verificationCode: json.codigo_verificacao ? String(json.codigo_verificacao) : null,
          publicUrl: json.url ? String(json.url) : null,
          pdfUrl: json.url_danfse ? String(json.url_danfse) : null,
          xmlUrl: json.caminho_xml_nota_fiscal ? `${this.base}${String(json.caminho_xml_nota_fiscal)}` : null,
          issuedAt: json.data_emissao ? new Date(String(json.data_emissao)) : this.agora(),
        });
      case 'erro_autorizacao':
        return this.resposta(ref, 'REJECTED', json, { rejectionReason: errosLegiveis(json) });
      case 'cancelado':
        return this.resposta(ref, 'CANCELED', json);
      default:
        // processando_autorizacao e qualquer estado novo que a Focus inventar:
        // segue na fila e a próxima consulta decide
        return this.resposta(ref, 'QUEUED', json);
    }
  }

  async cancelar(input: { providerRef: string | null; invoiceId: string; reason: string }): Promise<RespostaDeCancelamento> {
    const ref = input.providerRef ?? input.invoiceId;
    const { status, json } = await this.chamar('DELETE', `/v2/nfsen/${encodeURIComponent(ref)}`, { justificativa: input.reason });
    if (status >= 400 || json.status !== 'cancelado') {
      throw new Error(`A prefeitura não cancelou a nota: ${errosLegiveis(json)}`);
    }
    return { canceledAt: this.agora(), provider: this.driver, raw: json };
  }
}
