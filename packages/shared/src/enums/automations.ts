/**
 * Automações (V3, E21). O que o sistema faz sozinho **todo dia**, sem ninguém
 * abrir tela nenhuma.
 *
 * Nenhuma delas manda mensagem para o cliente por conta própria: o WhatsApp
 * continua sendo link `wa.me` que uma pessoa aperta (isso muda na E22, com a
 * API oficial). O que a automação faz é **deixar pronto** — a fila do dia, o
 * aviso no sino, o resumo por e-mail — para a oficina só decidir e enviar.
 */

export const AUTOMATION_KEYS = [
  'FOLLOW_UP_QUEUE',
  'APPOINTMENT_REMINDER',
  'QUOTE_NO_ANSWER',
  'DAILY_DIGEST',
] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export const AUTOMATION_LABELS: Record<AutomationKey, string> = {
  FOLLOW_UP_QUEUE: 'Fila de pós-venda',
  APPOINTMENT_REMINDER: 'Lembrete de agendamento',
  QUOTE_NO_ANSWER: 'Orçamento sem resposta',
  DAILY_DIGEST: 'Resumo do dia por e-mail',
};

export const AUTOMATION_DESCRIPTIONS: Record<AutomationKey, string> = {
  FOLLOW_UP_QUEUE:
    'De manhã, monta a fila de quem contatar hoje: pós-venda de 7 dias, revisão vencendo e quem não volta há 6 meses.',
  APPOINTMENT_REMINDER: 'Avisa no sino quais agendamentos de amanhã ainda não foram confirmados.',
  QUOTE_NO_ANSWER: 'Avisa quando um orçamento enviado fica sem resposta pelo tempo que você escolher.',
  DAILY_DIGEST: 'Manda por e-mail, uma vez por dia, o que precisa de atenção: fila, agenda e orçamentos parados.',
};

/** O que o sistema faz sozinho quando a oficina não mexeu em nada. */
export const AUTOMATION_DEFAULTS = {
  followUpQueue: true,
  appointmentReminder: true,
  quoteNoAnswer: true,
  /** o resumo por e-mail começa DESLIGADO: e-mail não pedido é spam */
  dailyDigest: false,
  /** hora do relógio da oficina em que tudo isso roda */
  runHour: 8,
  /** dias sem resposta antes de avisar do orçamento parado */
  quoteNoAnswerDays: 3,
} as const;
