import { z } from 'zod';

/**
 * Assistente com IA (E49): a pessoa da oficina pergunta em português — "tem
 * pastilha do Onix no estoque?", "o que tem na agenda amanhã?", "cadastra o
 * cliente João, WhatsApp 35 99999-0000" — e o assistente consulta o sistema.
 *
 * Duas regras que não se negociam:
 * 1. Ele **consulta** com as permissões de quem pergunta: o mecânico não vê
 *    pelo assistente o que não vê na tela.
 * 2. Ele **não grava nada sozinho**. Cadastro vira uma proposta com um botão;
 *    quem confirma é a pessoa, pela mesma rota (e validação) da tela normal.
 */

export const ASSISTANT_MAX_TURNS = 20;

export const assistantChatSchema = z.object({
  /** a conversa até aqui, só texto; a última é a pergunta nova */
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2_000),
      }),
    )
    .min(1)
    .max(ASSISTANT_MAX_TURNS),
});
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

export const assistantProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('customer'),
    name: z.string(),
    whatsapp: z.string(),
    email: z.string(),
  }),
  z.object({
    kind: z.literal('service'),
    name: z.string(),
    priceCents: z.number().int().nullable(),
    estimatedMinutes: z.number().int().nullable(),
  }),
]);
export type AssistantProposal = z.infer<typeof assistantProposalSchema>;

export const assistantReplySchema = z.object({
  reply: z.string(),
  /** atalhos para o que o assistente encontrou (a OS, a peça, o cliente) */
  links: z.array(z.object({ label: z.string(), href: z.string() })),
  proposals: z.array(assistantProposalSchema),
});
export type AssistantReply = z.infer<typeof assistantReplySchema>;

export const assistantStatusSchema = z.object({
  /** a chave da IA está configurada no servidor */
  enabled: z.boolean(),
  /** perguntas que a oficina ainda pode fazer hoje */
  remainingToday: z.number().int(),
});
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;
