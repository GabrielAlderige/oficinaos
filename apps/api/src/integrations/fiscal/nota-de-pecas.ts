import { createHash } from 'node:crypto';
import type { FiscalEnvironment, ProductInvoiceModel } from '@oficinaos/shared';

/**
 * Emissão da nota de PEÇAS (E50) atrás de uma interface, como a NFS-e: o
 * domínio monta o pedido, guarda a resposta e mostra o resultado; quem fala
 * com a SEFAZ é o driver.
 *
 * O **simulador** não emite nada (devolve `SIMULATOR`, e a tela carimba
 * "simulação"). O driver da **Focus NFe** segue a documentação v2:
 * https://doc.focusnfe.com.br/reference/emitir_nfce e /emitir_nfe.
 */

export interface PedidoDeNotaDePecas {
  /** id da nota no nosso banco: é a referência (`ref`) no emissor */
  invoiceId: string;
  modelo: ProductInvoiceModel;
  emitente: { cnpj: string; uf: string | null };
  destinatario: {
    nome: string;
    documento: string | null;
    endereco: { street: string; number: string; district: string; city: string; state: string; zip: string } | null;
  } | null;
  icmsSituacao: string;
  itens: {
    codigo: string;
    descricao: string;
    ncm: string;
    cfop: string;
    unidade: string;
    /** quantidade de verdade (4,5 L é 4.5) */
    quantidade: number;
    valorUnitarioCents: number;
    brutoCents: number;
    descontoCents: number;
  }[];
  pagamento: { forma: string; valorCents: number };
  totalCents: number;
  informacoesAdicionais: string | null;
}

export interface RespostaDaNotaDePecas {
  status: 'AUTHORIZED' | 'QUEUED' | 'REJECTED' | 'CANCELED';
  environment: FiscalEnvironment;
  provider: string;
  providerRef: string | null;
  number: string | null;
  series: string | null;
  accessKey: string | null;
  danfeUrl: string | null;
  xmlUrl: string | null;
  qrcodeUrl: string | null;
  issuedAt: Date | null;
  rejectionReason: string | null;
  raw: Record<string, unknown>;
}

export interface EmissorDeNotaDePecas {
  readonly driver: string;
  readonly environment: FiscalEnvironment;
  emitir(pedido: PedidoDeNotaDePecas): Promise<RespostaDaNotaDePecas>;
  /** a NF-e autoriza depois, em fila; a NFC-e responde na hora */
  consultar(input: { modelo: ProductInvoiceModel; ref: string }): Promise<RespostaDaNotaDePecas>;
  cancelar(input: { modelo: ProductInvoiceModel; ref: string; motivo: string }): Promise<{ canceledAt: Date; raw: Record<string, unknown> }>;
}

/**
 * Simulador: percorre o caminho inteiro sem nota de verdade. Não inventa
 * chave de acesso, DANFE nem QR Code — documento fiscal falso é o tipo de
 * coisa que não se gera.
 */
export class SimuladorDeNotaDePecas implements EmissorDeNotaDePecas {
  readonly driver = 'simulador';
  readonly environment: FiscalEnvironment = 'SIMULATOR';

  async emitir(pedido: PedidoDeNotaDePecas): Promise<RespostaDaNotaDePecas> {
    const digest = createHash('sha256').update(pedido.invoiceId).digest('hex');
    return {
      status: 'AUTHORIZED',
      environment: 'SIMULATOR',
      provider: this.driver,
      providerRef: pedido.invoiceId,
      number: String(parseInt(digest.slice(0, 8), 16) % 1_000_000),
      series: '1',
      accessKey: null,
      danfeUrl: null,
      xmlUrl: null,
      qrcodeUrl: null,
      issuedAt: new Date(),
      rejectionReason: null,
      raw: { simulacao: true, aviso: 'Nota SIMULADA: nenhum documento fiscal foi emitido.', modelo: pedido.modelo, totalCents: pedido.totalCents },
    };
  }

  async consultar(input: { modelo: ProductInvoiceModel; ref: string }): Promise<RespostaDaNotaDePecas> {
    return this.emitir({ invoiceId: input.ref, modelo: input.modelo } as PedidoDeNotaDePecas);
  }

  async cancelar(input: { ref: string; motivo: string }) {
    return { canceledAt: new Date(), raw: { simulacao: true, cancelada: input.ref, motivo: input.motivo } };
  }
}

// ------------------------------------------------------------------ Focus NFe

const BASE = {
  HOMOLOGATION: 'https://homologacao.focusnfe.com.br',
  PRODUCTION: 'https://api.focusnfe.com.br',
} as const;

type Corpo = Record<string, unknown>;
const reais = (centavos: number) => Math.round(centavos) / 100;
const digitos = (valor: string | null | undefined) => (valor ?? '').replace(/\D/g, '');

/** Agora no relógio de Brasília, com o fuso: a SEFAZ aceita até 5 minutos de diferença. */
function agoraNoBrasil(data: Date): string {
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
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}-03:00`;
}

/** Os itens, campo a campo como na documentação da Focus. */
function itensDaFocus(pedido: PedidoDeNotaDePecas, comPisCofins: boolean): Corpo[] {
  return pedido.itens.map((item, indice) => {
    const corpo: Corpo = {
      numero_item: String(indice + 1),
      codigo_produto: item.codigo.slice(0, 60),
      descricao: item.descricao.slice(0, 120),
      codigo_ncm: digitos(item.ncm),
      cfop: item.cfop,
      unidade_comercial: item.unidade,
      unidade_tributavel: item.unidade,
      quantidade_comercial: item.quantidade,
      quantidade_tributavel: item.quantidade,
      valor_unitario_comercial: reais(item.valorUnitarioCents),
      valor_unitario_tributavel: reais(item.valorUnitarioCents),
      valor_bruto: reais(item.brutoCents),
      icms_origem: '0',
      icms_situacao_tributaria: pedido.icmsSituacao,
    };
    if (item.descontoCents > 0) corpo.valor_desconto = reais(item.descontoCents);
    // no Simples, PIS e COFINS saem como "outras operações de saída" (49)
    if (comPisCofins) {
      corpo.pis_situacao_tributaria = '49';
      corpo.cofins_situacao_tributaria = '49';
    }
    return corpo;
  });
}

/** A NFC-e: nota do consumidor, autorizada na hora. */
export function montarNfce(pedido: PedidoDeNotaDePecas, agora: Date): Corpo {
  const corpo: Corpo = {
    cnpj_emitente: digitos(pedido.emitente.cnpj),
    data_emissao: agoraNoBrasil(agora),
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    presenca_comprador: '1',
    modalidade_frete: '9',
    local_destino: '1',
    items: itensDaFocus(pedido, false),
    formas_pagamento: [{ forma_pagamento: pedido.pagamento.forma, valor_pagamento: reais(pedido.pagamento.valorCents) }],
  };
  const doc = digitos(pedido.destinatario?.documento);
  // consumidor sem CPF vai como não identificado: a NFC-e aceita, e inventar documento seria nota errada
  if (doc.length === 11 || doc.length === 14) {
    corpo[doc.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario'] = doc;
    if (pedido.destinatario?.nome) corpo.nome_destinatario = pedido.destinatario.nome.slice(0, 60);
  }
  if (pedido.informacoesAdicionais) corpo.informacoes_adicionais_contribuinte = pedido.informacoesAdicionais.slice(0, 2000);
  return corpo;
}

/** A NF-e: nota para empresa, com endereço; a SEFAZ autoriza em fila. */
export function montarNfe(pedido: PedidoDeNotaDePecas, agora: Date): Corpo {
  const destino = pedido.destinatario!;
  const endereco = destino.endereco!;
  const doc = digitos(destino.documento);
  const descontos = pedido.itens.reduce((s, i) => s + i.descontoCents, 0);
  const brutos = pedido.itens.reduce((s, i) => s + i.brutoCents, 0);
  const mesmoEstado = !pedido.emitente.uf || pedido.emitente.uf.toUpperCase() === endereco.state.toUpperCase();
  return {
    natureza_operacao: 'Venda de mercadoria',
    data_emissao: agoraNoBrasil(agora),
    tipo_documento: '1',
    finalidade_emissao: '1',
    local_destino: mesmoEstado ? '1' : '2',
    consumidor_final: '1',
    presenca_comprador: '1',
    cnpj_emitente: digitos(pedido.emitente.cnpj),
    nome_destinatario: destino.nome.slice(0, 60),
    [doc.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: doc,
    indicador_inscricao_estadual_destinatario: '9',
    logradouro_destinatario: endereco.street,
    numero_destinatario: endereco.number,
    bairro_destinatario: endereco.district,
    municipio_destinatario: endereco.city,
    uf_destinatario: endereco.state.toUpperCase(),
    cep_destinatario: digitos(endereco.zip),
    modalidade_frete: '9',
    valor_produtos: reais(brutos),
    valor_desconto: reais(descontos),
    valor_total: reais(pedido.totalCents),
    items: itensDaFocus(
      {
        ...pedido,
        // fora do estado a operação é interestadual: o CFOP muda de 5 para 6
        itens: mesmoEstado ? pedido.itens : pedido.itens.map((i) => ({ ...i, cfop: i.cfop.replace(/^5/, '6') })),
      },
      pedido.icmsSituacao === '102',
    ),
  };
}

function errosLegiveis(corpo: Corpo): string {
  const erros = Array.isArray(corpo.erros) ? (corpo.erros as Corpo[]) : [];
  const linhas = erros.map((e) => String(e.mensagem ?? ''));
  if (corpo.mensagem_sefaz) linhas.push(String(corpo.mensagem_sefaz));
  if (!linhas.length && corpo.mensagem) linhas.push(String(corpo.mensagem));
  return linhas.filter(Boolean).join(' · ') || 'A SEFAZ recusou a nota sem dizer o motivo.';
}

export interface OpcoesFocusPecas {
  token: string;
  environment: keyof typeof BASE;
  fetch?: typeof fetch;
  agora?: () => Date;
}

export class FocusNotaDePecas implements EmissorDeNotaDePecas {
  readonly driver = 'focus';
  readonly environment;
  private readonly base: string;
  private readonly http: typeof fetch;
  private readonly agora: () => Date;
  private readonly autorizacao: string;

  constructor(opcoes: OpcoesFocusPecas) {
    this.environment = opcoes.environment;
    this.base = BASE[opcoes.environment];
    this.http = opcoes.fetch ?? fetch;
    this.agora = opcoes.agora ?? (() => new Date());
    // HTTP Basic: o token é o usuário, a senha fica vazia
    this.autorizacao = `Basic ${Buffer.from(`${opcoes.token}:`).toString('base64')}`;
  }

  private caminho(modelo: ProductInvoiceModel) {
    return modelo === 'NFCE' ? 'nfce' : 'nfe';
  }

  private async chamar(metodo: string, caminho: string, corpo?: Corpo): Promise<{ status: number; json: Corpo }> {
    const resposta = await this.http(`${this.base}${caminho}`, {
      method: metodo,
      headers: { authorization: this.autorizacao, 'content-type': 'application/json', accept: 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(60_000),
    });
    const texto = await resposta.text();
    let json: Corpo;
    try {
      json = texto ? (JSON.parse(texto) as Corpo) : {};
    } catch {
      json = { mensagem: texto.slice(0, 300) };
    }
    return { status: resposta.status, json };
  }

  private resposta(ref: string, status: RespostaDaNotaDePecas['status'], json: Corpo, extra: Partial<RespostaDaNotaDePecas> = {}): RespostaDaNotaDePecas {
    return {
      status,
      environment: this.environment,
      provider: this.driver,
      providerRef: ref,
      number: null,
      series: null,
      accessKey: null,
      danfeUrl: null,
      xmlUrl: null,
      qrcodeUrl: null,
      issuedAt: null,
      rejectionReason: null,
      raw: json,
      ...extra,
    };
  }

  private traduzir(ref: string, json: Corpo): RespostaDaNotaDePecas {
    const url = (caminho: unknown) => (caminho ? `${this.base}${String(caminho)}` : null);
    switch (json.status) {
      case 'autorizado':
        return this.resposta(ref, 'AUTHORIZED', json, {
          number: json.numero ? String(json.numero) : null,
          series: json.serie ? String(json.serie) : null,
          accessKey: json.chave_nfe ? String(json.chave_nfe).replace(/^NFe/, '') : null,
          danfeUrl: url(json.caminho_danfe),
          xmlUrl: url(json.caminho_xml_nota_fiscal),
          qrcodeUrl: json.qrcode_url ? String(json.qrcode_url) : null,
          issuedAt: this.agora(),
        });
      case 'erro_autorizacao':
      case 'denegado':
        return this.resposta(ref, 'REJECTED', json, { rejectionReason: errosLegiveis(json) });
      case 'cancelado':
        return this.resposta(ref, 'CANCELED', json);
      default:
        // processando_autorizacao (NF-e) e qualquer estado novo: segue na fila
        return this.resposta(ref, 'QUEUED', json);
    }
  }

  async emitir(pedido: PedidoDeNotaDePecas): Promise<RespostaDaNotaDePecas> {
    const ref = pedido.invoiceId;
    const corpo = pedido.modelo === 'NFCE' ? montarNfce(pedido, this.agora()) : montarNfe(pedido, this.agora());
    const { status, json } = await this.chamar('POST', `/v2/${this.caminho(pedido.modelo)}?ref=${encodeURIComponent(ref)}`, corpo);
    if (status === 401 || status === 403) {
      return this.resposta(ref, 'REJECTED', json, {
        rejectionReason: 'O emissor recusou a credencial desta oficina. Fale com o suporte do OficinaOS.',
      });
    }
    if (status >= 500) throw new Error(`Focus NFe respondeu ${status}`);
    if (status === 422 && /j[aá] existe|j[aá] foi/i.test(String(json.mensagem ?? ''))) {
      // a nota já tinha chegado lá (resposta perdida no caminho): consulta em vez de emitir de novo
      return this.consultar({ modelo: pedido.modelo, ref });
    }
    if (status >= 400) return this.resposta(ref, 'REJECTED', json, { rejectionReason: errosLegiveis(json) });
    return this.traduzir(ref, json);
  }

  async consultar(input: { modelo: ProductInvoiceModel; ref: string }): Promise<RespostaDaNotaDePecas> {
    const { status, json } = await this.chamar('GET', `/v2/${this.caminho(input.modelo)}/${encodeURIComponent(input.ref)}`);
    if (status >= 500) throw new Error(`Focus NFe respondeu ${status}`);
    if (status === 404) return this.resposta(input.ref, 'REJECTED', json, { rejectionReason: 'O emissor não encontrou esta nota. Emita de novo.' });
    return this.traduzir(input.ref, json);
  }

  async cancelar(input: { modelo: ProductInvoiceModel; ref: string; motivo: string }) {
    const { status, json } = await this.chamar('DELETE', `/v2/${this.caminho(input.modelo)}/${encodeURIComponent(input.ref)}`, {
      justificativa: input.motivo,
    });
    if (status >= 400 || json.status !== 'cancelado') {
      throw new Error(`A SEFAZ não cancelou a nota: ${errosLegiveis(json)}`);
    }
    return { canceledAt: this.agora(), raw: json };
  }
}
