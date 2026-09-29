/**
 * Ficha do carro (E31): o que toda oficina procura, na mesma ordem para todo
 * veículo.
 *
 * A lista é FIXA de propósito. Se cada ficha tivesse a sua organização, quem
 * preenche decidiria a estrutura cinquenta vezes e quem consulta nunca saberia
 * onde olhar. O que for específico de um carro entra como item extra.
 *
 * Esta lista é da PLATAFORMA, não da oficina: mudar uma chave aqui muda o
 * significado de dados já preenchidos, então chave nova se acrescenta, nunca
 * se renomeia.
 */
export const SPEC_GROUPS = ['MOTOR', 'FILTROS', 'FREIOS', 'SUSPENSAO', 'ELETRICA', 'FLUIDOS', 'PNEUS'] as const;
export type SpecGroup = (typeof SPEC_GROUPS)[number];

export const SPEC_GROUP_LABELS: Record<SpecGroup, string> = {
  MOTOR: 'Motor',
  FILTROS: 'Filtros',
  FREIOS: 'Freios',
  SUSPENSAO: 'Suspensão',
  ELETRICA: 'Elétrica',
  FLUIDOS: 'Fluidos',
  PNEUS: 'Pneus e rodas',
};

export interface SpecItem {
  key: string;
  group: SpecGroup;
  label: string;
  /** o que escrever no campo — some quando já tem valor */
  hint: string;
}

export const SPEC_ITEMS: SpecItem[] = [
  { key: 'oleo_motor', group: 'MOTOR', label: 'Óleo do motor', hint: 'Ex.: 5W30 sintético · 3,5 L' },
  { key: 'velas', group: 'MOTOR', label: 'Velas de ignição', hint: 'Ex.: NGK BKR6E-11 · 4 un' },
  { key: 'correia_dentada', group: 'MOTOR', label: 'Correia dentada', hint: 'Ex.: Gates 5528XS · trocar a cada 60.000 km' },
  { key: 'correia_acessorios', group: 'MOTOR', label: 'Correia de acessórios', hint: 'Ex.: 6PK1015' },

  { key: 'filtro_oleo', group: 'FILTROS', label: 'Filtro de óleo', hint: 'Ex.: Tecfil PSL560' },
  { key: 'filtro_ar', group: 'FILTROS', label: 'Filtro de ar', hint: 'Ex.: Tecfil ARL8210' },
  { key: 'filtro_combustivel', group: 'FILTROS', label: 'Filtro de combustível', hint: 'Ex.: Tecfil GI06/7' },
  { key: 'filtro_cabine', group: 'FILTROS', label: 'Filtro de cabine', hint: 'Ex.: Tecfil ACP944' },

  { key: 'pastilha_dianteira', group: 'FREIOS', label: 'Pastilha dianteira', hint: 'Ex.: Cobreq N-1234' },
  { key: 'pastilha_traseira', group: 'FREIOS', label: 'Pastilha traseira', hint: 'Deixe vazio se for tambor' },
  { key: 'disco_dianteiro', group: 'FREIOS', label: 'Disco dianteiro', hint: 'Ex.: ventilado · 256 mm' },
  { key: 'lona_tambor', group: 'FREIOS', label: 'Lona / tambor traseiro', hint: 'Ex.: 200 mm' },

  { key: 'amortecedor_dianteiro', group: 'SUSPENSAO', label: 'Amortecedor dianteiro', hint: 'Ex.: Cofap GP32835' },
  { key: 'amortecedor_traseiro', group: 'SUSPENSAO', label: 'Amortecedor traseiro', hint: 'Ex.: Cofap GB32836' },
  { key: 'pivo_bandeja', group: 'SUSPENSAO', label: 'Pivô e bandeja', hint: 'Ex.: pivô Nakata N99001' },

  { key: 'bateria', group: 'ELETRICA', label: 'Bateria', hint: 'Ex.: 60 Ah · polo positivo à direita' },
  { key: 'lampada_farol', group: 'ELETRICA', label: 'Lâmpada do farol', hint: 'Ex.: H4 55/60W' },

  { key: 'fluido_freio', group: 'FLUIDOS', label: 'Fluido de freio', hint: 'Ex.: DOT 4 · trocar a cada 2 anos' },
  { key: 'oleo_cambio', group: 'FLUIDOS', label: 'Óleo do câmbio', hint: 'Ex.: 75W80 · 2,0 L (manual)' },
  { key: 'fluido_arrefecimento', group: 'FLUIDOS', label: 'Aditivo do radiador', hint: 'Ex.: orgânico rosa · 5,0 L' },

  { key: 'pneu', group: 'PNEUS', label: 'Medida do pneu', hint: 'Ex.: 175/70 R14' },
  { key: 'torque_roda', group: 'PNEUS', label: 'Torque da roda', hint: 'Ex.: 110 N·m · 4 furos' },
  { key: 'alinhamento', group: 'PNEUS', label: 'Alinhamento', hint: 'Ex.: cambagem −0°30′' },
];

export const SPEC_ITEM_BY_KEY = new Map(SPEC_ITEMS.map((item) => [item.key, item]));

/** Os itens de um grupo, na ordem em que foram declarados. */
export const specItemsOfGroup = (group: SpecGroup): SpecItem[] =>
  SPEC_ITEMS.filter((item) => item.group === group);
