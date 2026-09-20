/**
 * Regras puras da nota fiscal de serviço (E18). Moram aqui porque as mesmas
 * contas aparecem em três lugares: a tela mostrando a prévia antes de emitir,
 * a API montando o pedido para o emissor, e o relatório somando o ISS do mês.
 *
 * Dinheiro em centavos e alíquota em **pontos-base** (bps: 2% = 200), como no
 * resto do sistema — alíquota de ISS com casa decimal (2,5%) é comum, e
 * guardar 250 evita o arredondamento que faria a nota fechar por um centavo
 * de diferença da prefeitura.
 */

import type { TaxRegime } from './enums/fiscal';

/** 2% de R$ 1.000,00 = R$ 20,00. Arredonda meio para cima, como a prefeitura. */
export function impostoPorAliquota(baseCents: number, aliquotaBps: number): number {
  if (baseCents <= 0 || aliquotaBps <= 0) return 0;
  return Math.round((baseCents * aliquotaBps) / 10_000);
}

export interface BaseDaNota {
  /** soma dos serviços, em centavos */
  servicosCents: number;
  /** o que a lei do município deixa abater da base (material, subempreitada) */
  deducoesCents?: number;
  /** desconto dado ao cliente, que também tira da base */
  descontoCents?: number;
  aliquotaIssBps: number;
  /** tomador desconta o ISS e recolhe no lugar da oficina */
  issRetido?: boolean;
  /** retenções federais, quando o tomador é PJ obrigada a reter */
  irrfCents?: number;
  pisCents?: number;
  cofinsCents?: number;
  csllCents?: number;
  inssCents?: number;
}

export interface TotaisDaNota {
  baseCalculoCents: number;
  issCents: number;
  /** ISS que a oficina recolhe (zero quando o tomador retém) */
  issDevidoCents: number;
  issRetidoCents: number;
  retencoesFederaisCents: number;
  /** o que a nota diz no total */
  totalCents: number;
  /** o que a oficina recebe depois das retenções */
  liquidoCents: number;
}

/**
 * Os números da nota. Repare que **o total da nota não muda com o ISS**: o
 * imposto sai de dentro do preço do serviço (é assim no ISS). O que muda é o
 * líquido, quando o tomador retém.
 */
export function totaisDaNota(entrada: BaseDaNota): TotaisDaNota {
  const deducoes = Math.max(0, entrada.deducoesCents ?? 0);
  const desconto = Math.max(0, entrada.descontoCents ?? 0);
  const servicos = Math.max(0, entrada.servicosCents);
  const base = Math.max(0, servicos - deducoes - desconto);
  const iss = impostoPorAliquota(base, entrada.aliquotaIssBps);
  const retido = entrada.issRetido === true;
  const federais =
    Math.max(0, entrada.irrfCents ?? 0) +
    Math.max(0, entrada.pisCents ?? 0) +
    Math.max(0, entrada.cofinsCents ?? 0) +
    Math.max(0, entrada.csllCents ?? 0) +
    Math.max(0, entrada.inssCents ?? 0);
  const total = Math.max(0, servicos - desconto);
  return {
    baseCalculoCents: base,
    issCents: iss,
    issDevidoCents: retido ? 0 : iss,
    issRetidoCents: retido ? iss : 0,
    retencoesFederaisCents: federais,
    totalCents: total,
    liquidoCents: Math.max(0, total - (retido ? iss : 0) - federais),
  };
}

/** Um dado que falta para conseguir emitir, já escrito do jeito que a tela mostra. */
export interface PendenciaFiscal {
  /** onde resolver: 'oficina' | 'cliente' | 'os' */
  onde: 'oficina' | 'cliente' | 'os';
  campo: string;
  mensagem: string;
}

export interface DadosDaOficinaParaNota {
  document: string | null;
  legalName: string | null;
  municipalRegistration: string | null;
  taxRegime: TaxRegime | null;
  serviceListItem: string | null;
  issRateBps: number | null;
  city: string | null;
  state: string | null;
}

export interface DadosDoTomadorParaNota {
  name: string;
  document: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  street: string | null;
  number: string | null;
}

/**
 * O que ainda falta para a nota sair. Isto roda ANTES de chamar o emissor,
 * porque rejeição de prefeitura chega em código ("E145") e a oficina não tem
 * como adivinhar o que fazer. Aqui a mensagem diz o campo e onde arrumar.
 *
 * O CPF do tomador é a única exceção tolerada: nota para pessoa física sem
 * documento é aceita em boa parte dos municípios ("consumidor não
 * identificado"), então isso vira aviso da tela, não impedimento.
 */
export function pendenciasParaEmitir(
  oficina: DadosDaOficinaParaNota,
  tomador: DadosDoTomadorParaNota,
  servicosCents: number,
): PendenciaFiscal[] {
  const faltando: PendenciaFiscal[] = [];
  const exigir = (
    valor: string | number | null | undefined,
    onde: PendenciaFiscal['onde'],
    campo: string,
    mensagem: string,
  ) => {
    const vazio = valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');
    if (vazio) faltando.push({ onde, campo, mensagem });
  };

  exigir(oficina.document, 'oficina', 'document', 'Falta o CNPJ da oficina.');
  exigir(oficina.legalName, 'oficina', 'legalName', 'Falta a razão social da oficina.');
  exigir(
    oficina.municipalRegistration,
    'oficina',
    'municipalRegistration',
    'Falta a inscrição municipal: é ela que identifica a oficina na prefeitura.',
  );
  exigir(oficina.taxRegime, 'oficina', 'taxRegime', 'Falta o regime tributário.');
  exigir(
    oficina.serviceListItem,
    'oficina',
    'serviceListItem',
    'Falta o item da lista de serviços (LC 116) — para oficina costuma ser 14.01.',
  );
  exigir(oficina.city, 'oficina', 'address.city', 'Falta a cidade da oficina: a NFS-e é municipal.');
  exigir(oficina.state, 'oficina', 'address.state', 'Falta o estado da oficina.');
  if (oficina.issRateBps === null || oficina.issRateBps === undefined) {
    faltando.push({ onde: 'oficina', campo: 'issRateBps', mensagem: 'Falta a alíquota de ISS do município.' });
  }

  exigir(tomador.city, 'cliente', 'address.city', 'Falta a cidade do cliente.');
  exigir(tomador.state, 'cliente', 'address.state', 'Falta o estado do cliente.');
  exigir(tomador.street, 'cliente', 'address.street', 'Falta o endereço do cliente.');

  if (servicosCents <= 0) {
    faltando.push({
      onde: 'os',
      campo: 'items',
      mensagem: 'A OS não tem serviço aprovado: a nota de serviço precisa de ao menos um.',
    });
  }
  return faltando;
}

/**
 * O texto que vai no campo "discriminação dos serviços" da nota. A prefeitura
 * mostra isso para o cliente, então ele precisa reconhecer o próprio carro:
 * placa e modelo entram junto com a lista do que foi feito.
 */
export function discriminacaoDosServicos(
  veiculo: { plate: string | null; make: string | null; model: string | null },
  servicos: { description: string; quantity: number; totalCents: number }[],
  numeroDaOs: number,
): string {
  const carro = [veiculo.make, veiculo.model].filter(Boolean).join(' ');
  // veículo sem placa existe (moto que chegou de guincho, carro zero sem
  // emplacar): o texto continua legível sem ela
  const identificacao = [veiculo.plate, carro && `(${carro})`].filter(Boolean).join(' ');
  const cabecalho = `Serviços prestados no veículo${identificacao ? ` ${identificacao}` : ''} — OS nº ${numeroDaOs}.`;
  const linhas = servicos.map((servico) => {
    const quantidade = servico.quantity > 1 ? `${servico.quantity}x ` : '';
    return `- ${quantidade}${servico.description}`;
  });
  return [cabecalho, ...linhas].join('\n');
}
