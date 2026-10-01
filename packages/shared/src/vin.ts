/**
 * Leitura do chassi (VIN) — marca e ano-modelo (E43).
 *
 * O que dá para extrair de um chassi **sem base paga**, e o que não dá:
 *
 * | Posição | O que é | Dá para ler? |
 * |---|---|---|
 * | 1 a 3 | WMI, o código do fabricante | **Sim** — é padrão internacional (ISO 3780) e público |
 * | 4 a 8 | VDS, descritor do veículo | **Não** — cada montadora define o seu, e não há tabela pública |
 * | 9 | dígito verificador | calculável, mas ver a nota abaixo |
 * | 10 | ano-modelo | **Sim** — codificação padronizada |
 * | 11 | planta de montagem | do fabricante |
 * | 12 a 17 | número de série | — |
 *
 * Por isso esta leitura devolve **marca e ano**, nunca o modelo. Quem escolhe o
 * modelo é a pessoa, numa lista já reduzida de 292 fichas para três ou quatro.
 * Prometer o modelo exato exigiria consulta veicular paga.
 */

/** O chassi tem 17 caracteres e não usa I, O nem Q — para não confundir com 1 e 0. */
export const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/;

export function pareceVin(valor: string): boolean {
  return VIN_REGEX.test(valor.trim().toUpperCase());
}

/**
 * WMI → marca, como a marca está escrita no catálogo de fichas.
 *
 * A tabela é **curada, não exaustiva**: cobre o que roda na frota brasileira e
 * as marcas que têm ficha hoje. WMI desconhecido não é erro — a tela diz que
 * não reconheceu e pede o modelo, que é melhor do que chutar uma marca errada
 * e mostrar a ficha de outro carro.
 *
 * Acrescentar marca aqui é acrescentar uma linha.
 */
export const WMI_MARCAS: Record<string, string> = {
  // ---- fabricados no Brasil (o 9 inicial é a América do Sul) ----
  '9BD': 'Fiat',
  '9BG': 'Chevrolet',
  '9BW': 'Volkswagen',
  '9BF': 'Ford',
  '9BR': 'Toyota',
  '9BM': 'Mercedes-Benz',
  '9BH': 'Hyundai',
  '93H': 'Honda',
  '93Y': 'Renault',
  '94D': 'Nissan',
  '936': 'Peugeot',
  '935': 'Citroën',
  '98R': 'Jeep',

  // ---- Argentina, que abastece muito o mercado brasileiro ----
  '8AP': 'Peugeot',
  '8AF': 'Ford',
  '8AG': 'Chevrolet',
  '8AC': 'Mercedes-Benz',
  '8A1': 'Renault',
  '8AW': 'Volkswagen',
  '8AD': 'Peugeot',
  '8AJ': 'Toyota',

  // ---- importados comuns ----
  KMH: 'Hyundai',
  KNA: 'Kia',
  KNB: 'Kia',
  KNC: 'Kia',
  KND: 'Kia',
  KNE: 'Kia',
  JHM: 'Honda',
  JHL: 'Honda',
  JTD: 'Toyota',
  JTE: 'Toyota',
  JTH: 'Toyota',
  JTL: 'Toyota',
  JTM: 'Toyota',
  JTN: 'Toyota',
  JN1: 'Nissan',
  JN8: 'Nissan',
  '3N1': 'Nissan',
  '1G1': 'Chevrolet',
  '3G1': 'Chevrolet',
  WVW: 'Volkswagen',
  WV1: 'Volkswagen',
  WV2: 'Volkswagen',
  ZFA: 'Fiat',
  VF3: 'Peugeot',
  VF7: 'Citroën',
  VF1: 'Renault',
  '1C4': 'Jeep',
  '1J4': 'Jeep',
};

/**
 * A 10ª posição diz o ano-modelo, num ciclo de 30 anos.
 *
 * A sequência pula I, O, Q, U e Z pela mesma razão do resto do chassi. Como o
 * ciclo repete a cada 30 anos, `A` tanto pode ser 1980 quanto 2010 — e não há
 * desempate, veja `anosDoCodigo`.
 */
const CODIGOS_DE_ANO = 'ABCDEFGHJKLMNPRSTVWXY123456789'.split('');

/**
 * Devolve TODOS os anos possíveis para o código, do mais recente ao mais antigo.
 *
 * O ciclo repete de 30 em 30 anos, então `V` é 1997 **e** 2027 — e não há nada
 * no chassi que desempate. Chutar o mais recente parece esperto e é errado no
 * caso que mais importa: um Gol 1997 viraria "2027", e a ficha certa ficaria de
 * fora do filtro. Mostrar as duas datas é feio e acha o carro; chutar uma é
 * bonito e esconde a ficha.
 */
export function anosDoCodigo(codigo: string, agora = new Date()): number[] {
  const indice = CODIGOS_DE_ANO.indexOf(codigo.toUpperCase());
  if (indice === -1) return [];

  const teto = agora.getFullYear() + 1;
  const anos: number[] = [];
  for (let ano = 1980 + indice; ano <= teto; ano += 30) anos.push(ano);
  return anos.reverse();
}

export interface LeituraDoChassi {
  /** o chassi normalizado, em maiúsculas e sem espaço */
  vin: string;
  /** null quando o WMI não está na tabela */
  make: string | null;
  /**
   * Todos os anos que o código admite, do mais recente ao mais antigo. Quase
   * sempre dois, porque o ciclo repete de 30 em 30 anos.
   */
  years: number[];
  /** o código do fabricante, para a tela poder mostrar por que não reconheceu */
  wmi: string;
}

/**
 * Lê o chassi. Devolve `null` quando não tem cara de chassi — assim quem chama
 * trata o texto como busca comum, e a pessoa não precisa escolher entre dois
 * campos.
 */
export function lerChassi(valor: string, agora = new Date()): LeituraDoChassi | null {
  const vin = valor.trim().toUpperCase();
  if (!VIN_REGEX.test(vin)) return null;

  const wmi = vin.slice(0, 3);
  return {
    vin,
    wmi,
    make: WMI_MARCAS[wmi] ?? null,
    years: anosDoCodigo(vin[9]!, agora),
  };
}

/** O que a tela diz depois de ler o chassi. */
export function resumoDoChassi(leitura: LeituraDoChassi): string {
  const anos = leitura.years.length
    ? `ano-modelo ${[...leitura.years].sort((a, b) => a - b).join(' ou ')}`
    : '';
  if (leitura.make && anos) return `${leitura.make}, ${anos}`;
  if (leitura.make) return `${leitura.make} — não consegui ler o ano`;
  if (anos) return `${anos} — marca não reconhecida (${leitura.wmi})`;
  return `não reconheci este chassi (${leitura.wmi})`;
}
