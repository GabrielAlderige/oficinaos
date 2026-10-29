import { z } from 'zod';
import { DEFAULT_CHECKIN_CHECKLIST } from './enums/work-orders';

/**
 * Checklists da oficina (E49). Cada oficina monta os seus — "Entrada padrão",
 * "Revisão", "Ar-condicionado" — com os itens na ordem que o mecânico
 * percorre o carro, e escolhe qual usar no check-in.
 *
 * O check-in continua gravando o checklist INTEIRO na inspeção (rótulo e
 * resposta): mudar o modelo amanhã não reescreve o que o carro mostrou hoje.
 * Oficina sem modelo nenhum usa o padrão do sistema.
 */

export const CHECKLIST_MAX_ITEMS = 40;

export const checklistItemSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(2, 'Escreva o item').max(120, 'Use no máximo 120 caracteres'),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const checklistTemplateInputSchema = z.object({
  name: z.string().trim().min(2, 'Dê um nome ao checklist').max(60, 'Use no máximo 60 caracteres'),
  /** a ordem da lista é a ordem do check-in; a chave nasce no servidor quando falta */
  items: z
    .array(
      z.object({
        key: z.string().trim().max(60).optional(),
        label: checklistItemSchema.shape.label,
      }),
    )
    .min(1, 'Coloque pelo menos um item')
    .max(CHECKLIST_MAX_ITEMS, `No máximo ${CHECKLIST_MAX_ITEMS} itens`),
});
export type ChecklistTemplateInput = z.input<typeof checklistTemplateInputSchema>;

export const checklistTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  items: z.array(checklistItemSchema),
  position: z.number().int(),
});
export type ChecklistTemplate = z.infer<typeof checklistTemplateSchema>;

/** O modelo que vale quando a oficina ainda não montou nenhum. */
export const SYSTEM_CHECKLIST: Omit<ChecklistTemplate, 'id'> & { id: null } = {
  id: null,
  name: 'Entrada padrão',
  items: DEFAULT_CHECKIN_CHECKLIST.map((item) => ({ key: item.key, label: item.label })),
  position: 0,
};

/**
 * Chave estável do item a partir do rótulo ("Faróis e lanternas" →
 * "farois-e-lanternas"), única na lista. É ela que liga a resposta ao item
 * no check-in; o rótulo pode ser corrigido sem perder a resposta.
 */
export function checklistKeys(items: { key?: string; label: string }[]): ChecklistItem[] {
  const usadas = new Set<string>();
  return items.map((item) => {
    const base =
      (item.key?.trim() ||
        item.label
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50)) ||
      'item';
    let chave = base;
    for (let n = 2; usadas.has(chave); n += 1) chave = `${base}-${n}`;
    usadas.add(chave);
    return { key: chave, label: item.label.trim() };
  });
}
