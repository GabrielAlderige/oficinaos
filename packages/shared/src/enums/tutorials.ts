/**
 * Tutoriais em vídeo (E39).
 *
 * Os módulos são FIXOS e seguem a ordem do dia da oficina, não a ordem em que
 * o sistema foi construído: quem abre o tutorial quer aprender a trabalhar,
 * não a história do produto. Módulo novo se acrescenta no fim; renomear um
 * já publicado muda o significado das aulas que estão dentro dele.
 */
export const TUTORIAL_MODULES = [
  'PRIMEIROS_PASSOS',
  'CLIENTES',
  'AGENDA',
  'ORDEM_DE_SERVICO',
  'ORCAMENTO',
  'PECAS',
  'DINHEIRO',
  'FICHA_DO_CARRO',
  'PAINEL',
  'POS_VENDA',
  'WHATSAPP',
  'CELULAR',
  'CONFIGURACOES',
] as const;
export type TutorialModule = (typeof TUTORIAL_MODULES)[number];

export const TUTORIAL_MODULE_LABELS: Record<TutorialModule, string> = {
  PRIMEIROS_PASSOS: 'Primeiros passos',
  CLIENTES: 'Clientes e veículos',
  AGENDA: 'Agenda',
  ORDEM_DE_SERVICO: 'Ordem de serviço',
  ORCAMENTO: 'Orçamento e aprovação',
  PECAS: 'Peças, estoque e compras',
  DINHEIRO: 'Dinheiro',
  FICHA_DO_CARRO: 'Ficha do carro',
  PAINEL: 'Painel e relatórios',
  POS_VENDA: 'Pós-venda e clientes novos',
  WHATSAPP: 'WhatsApp',
  CELULAR: 'No celular',
  CONFIGURACOES: 'Configurações e equipe',
};

/** Uma frase dizendo para que serve o módulo, mostrada acima das aulas. */
export const TUTORIAL_MODULE_HINTS: Record<TutorialModule, string> = {
  PRIMEIROS_PASSOS: 'O mínimo para a oficina começar a trabalhar hoje.',
  CLIENTES: 'Cadastrar sem retrabalho e achar o carro pela placa.',
  AGENDA: 'Marcar, remarcar e transformar o agendamento em OS.',
  ORDEM_DE_SERVICO: 'Do check-in à entrega, com foto e assinatura.',
  ORCAMENTO: 'O link que o cliente aprova pelo celular.',
  PECAS: 'Estoque que bate, cotação com fornecedor e compra.',
  DINHEIRO: 'Receber, cobrar, comissão e nota fiscal.',
  FICHA_DO_CARRO: 'Óleo, fluido e torque com a fonte de cada valor.',
  PAINEL: 'Ler a oficina de relance e tirar relatório.',
  POS_VENDA: 'Trazer o cliente de volta e não perder o que chega.',
  WHATSAPP: 'Do link pronto à conta oficial conectada.',
  CELULAR: 'O sistema instalado no telefone do mecânico.',
  CONFIGURACOES: 'Equipe, preços, plano e o que fica ligado.',
};

/**
 * Onde o vídeo está hospedado. Não guardamos arquivo de vídeo: o `player`
 * decide como montar o endereço do embed a partir da `videoUrl`, e trocar de
 * hospedagem é trocar este campo, não migrar gigabytes.
 */
export const TUTORIAL_PLAYERS = ['YOUTUBE', 'VIMEO', 'ARQUIVO'] as const;
export type TutorialPlayer = (typeof TUTORIAL_PLAYERS)[number];

export const TUTORIAL_PLAYER_LABELS: Record<TutorialPlayer, string> = {
  YOUTUBE: 'YouTube',
  VIMEO: 'Vimeo',
  ARQUIVO: 'Link direto (MP4)',
};

/** `mm:ss` a partir dos segundos; `null` quando a aula ainda não tem duração. */
export function duracaoLegivel(segundos: number | null): string | null {
  if (segundos === null || segundos <= 0) return null;
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return `${min}:${String(seg).padStart(2, '0')}`;
}
