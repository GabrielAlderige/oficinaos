import { z } from 'zod';
import { AUTOMATION_KEYS } from '../enums/automations';

/** O que a oficina liga, desliga e escolhe nas automações (E21). */
export const automationSettingsSchema = z.object({
  followUpQueue: z.boolean(),
  appointmentReminder: z.boolean(),
  quoteNoAnswer: z.boolean(),
  dailyDigest: z.boolean(),
  /** hora do relógio da oficina em que as automações rodam */
  runHour: z.number().int().min(0).max(23),
  /** dias sem resposta antes de avisar do orçamento parado */
  quoteNoAnswerDays: z.number().int().min(1).max(30),
  /** para onde vai o resumo; vazio = o e-mail da oficina */
  digestEmail: z.email().nullable(),
  /** ligado no servidor? sem fila de jobs, tudo isto é manual */
  workerEnabled: z.boolean(),
  updatedAt: z.iso.datetime().nullable(),
});
export type AutomationSettings = z.infer<typeof automationSettingsSchema>;

export const updateAutomationSettingsSchema = automationSettingsSchema
  .omit({ updatedAt: true, workerEnabled: true })
  .partial();
export type UpdateAutomationSettingsInput = z.infer<typeof updateAutomationSettingsSchema>;

/** O que aconteceu na última vez que cada automação rodou. */
export const automationRunSchema = z.object({
  key: z.enum(AUTOMATION_KEYS),
  ranAt: z.iso.datetime(),
  /** quantas coisas ela criou (contatos na fila, avisos, e-mails) */
  created: z.number().int(),
  durationMs: z.number().int(),
  error: z.string().nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const automationsOverviewSchema = z.object({
  settings: automationSettingsSchema,
  runs: z.array(automationRunSchema),
});
export type AutomationsOverview = z.infer<typeof automationsOverviewSchema>;

export const runAutomationSchema = z.object({ key: z.enum(AUTOMATION_KEYS) });
export type RunAutomationInput = z.infer<typeof runAutomationSchema>;
