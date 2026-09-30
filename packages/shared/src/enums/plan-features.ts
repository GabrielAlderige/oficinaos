/**
 * O que cada plano libera (E40).
 *
 * Antes desta lista, a coluna `features` da tabela `plans` era **enfeite**: ela
 * era lida para desenhar a tela de planos e nunca para decidir nada. Quem
 * pagava o Turbo tinha o mesmo sistema de quem pagava o Nitro, menos as vagas
 * de usuário — o único limite que existia de verdade.
 *
 * Aqui a lista é tipada e vira a fonte única: a API barra por ela (as rotas
 * declaram `config.feature`) e o painel esconde o menu pela mesma matriz. Quem
 * garante é a API — o painel só evita mostrar porta que não abre.
 */
export const PLAN_FEATURES = [
  'quotes',
  'appointments',
  'inventory',
  'vehicle_specs',
  'pix_charge',
  'mobile_app',
  'finance',
  'delivery_proof',
  'commissions',
  'service_packages',
  'reports',
  'parts_search',
  'whatsapp_api',
  'automations',
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** O nome que o dono da oficina lê. Não usar o código em tela nenhuma. */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  quotes: 'Orçamento por link',
  appointments: 'Agenda',
  inventory: 'Estoque e custo médio',
  vehicle_specs: 'Ficha do carro',
  pix_charge: 'Pix na hora com QR Code',
  mobile_app: 'Aplicativo no celular',
  finance: 'Financeiro: a receber e caixa',
  delivery_proof: 'Assinatura e foto na entrega',
  commissions: 'Comissão do mecânico',
  service_packages: 'Pacotes de serviço',
  reports: 'Relatórios e exportação',
  parts_search: 'Pesquisa de peças por carro',
  whatsapp_api: 'WhatsApp oficial (conta da Meta)',
  automations: 'Automações diárias',
};

/**
 * O que **ainda não existe** no sistema.
 *
 * Fica numa lista separada de propósito: a tela de planos mostra isso como
 * "em desenvolvimento", nunca com o ✓ de incluído. Três destes já estiveram
 * na coluna `features` do Nitro com visual de incluído — multi-filial, papéis
 * customizados e API pública — vendendo por R$ 499 o que não tinha uma linha
 * de código. Nada entra aqui como incluído antes de existir.
 */
export const ROADMAP_FEATURES = [
  'suppliers',
  'purchasing',
  'multi_branch',
  'custom_roles',
  'public_api',
] as const;
export type RoadmapFeature = (typeof ROADMAP_FEATURES)[number];

export const ROADMAP_FEATURE_LABELS: Record<RoadmapFeature, string> = {
  suppliers: 'Fornecedores e cotação por link',
  purchasing: 'Compras e recebimento',
  multi_branch: 'Mais de uma unidade',
  custom_roles: 'Papéis customizados',
  public_api: 'API pública',
};

/**
 * A composição de cada plano.
 *
 * É a mesma coisa que a migration grava na coluna `features`, e o teste
 * `plan-features.test.ts` compara as duas — banco e código não podem divergir,
 * senão a tela promete uma coisa e a API barra outra.
 *
 * O desenho: o Turbo é a oficina pequena trabalhando inteira (abre a OS, manda
 * o orçamento, recebe, sabe o que tem a receber). O Supercharger é quem quer
 * **entender** a oficina — comissão, relatório, pacote. O Nitro é quem quer o
 * sistema **trabalhando sozinho** — WhatsApp oficial, automações, e a pesquisa
 * que cruza o estoque com o carro da OS.
 */
const TURBO_FEATURES: readonly PlanFeature[] = [
  'quotes',
  'appointments',
  'inventory',
  'vehicle_specs',
  'pix_charge',
  'mobile_app',
  'finance',
  'delivery_proof',
];

const SUPERCHARGER_FEATURES: readonly PlanFeature[] = [
  ...TURBO_FEATURES,
  'commissions',
  'service_packages',
  'reports',
];

const NITRO_FEATURES: readonly PlanFeature[] = [
  ...SUPERCHARGER_FEATURES,
  'parts_search',
  'whatsapp_api',
  'automations',
];

export const PLAN_FEATURE_MATRIX = {
  TURBO: TURBO_FEATURES,
  SUPERCHARGER: SUPERCHARGER_FEATURES,
  NITRO: NITRO_FEATURES,
} as const satisfies Record<string, readonly PlanFeature[]>;

/** O plano inclui esta funcionalidade? */
export function planoInclui(features: readonly string[], feature: PlanFeature): boolean {
  return features.includes(feature);
}

/**
 * O plano mais barato que inclui a funcionalidade — é o que a tela de bloqueio
 * oferece. Devolve `null` quando nenhum plano tem (não deveria acontecer: o
 * teste cobre isso).
 */
export function planoMaisBaratoCom(feature: PlanFeature): keyof typeof PLAN_FEATURE_MATRIX | null {
  const ordem = ['TURBO', 'SUPERCHARGER', 'NITRO'] as const;
  return ordem.find((code) => PLAN_FEATURE_MATRIX[code].includes(feature)) ?? null;
}
