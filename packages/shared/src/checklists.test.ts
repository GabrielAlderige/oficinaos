import { describe, expect, it } from 'vitest';
import { checklistKeys, checklistTemplateInputSchema, SYSTEM_CHECKLIST } from './checklists';

describe('checklists da oficina (E49)', () => {
  it('a chave sai do rótulo, sem acento, e não repete na lista', () => {
    expect(checklistKeys([{ label: 'Faróis e lanternas' }, { label: 'Faróis e lanternas' }, { label: 'Óleo' }])).toEqual([
      { key: 'farois-e-lanternas', label: 'Faróis e lanternas' },
      { key: 'farois-e-lanternas-2', label: 'Faróis e lanternas' },
      { key: 'oleo', label: 'Óleo' },
    ]);
  });

  it('chave que já existe é mantida: corrigir o rótulo não perde a ligação', () => {
    expect(checklistKeys([{ key: 'lights', label: 'Faróis, lanternas e setas' }])).toEqual([
      { key: 'lights', label: 'Faróis, lanternas e setas' },
    ]);
  });

  it('checklist sem item ou sem nome é recusado', () => {
    expect(checklistTemplateInputSchema.safeParse({ name: 'Revisão', items: [] }).success).toBe(false);
    expect(checklistTemplateInputSchema.safeParse({ name: '', items: [{ label: 'Freios' }] }).success).toBe(false);
    expect(checklistTemplateInputSchema.safeParse({ name: 'Revisão', items: [{ label: 'Freios' }] }).success).toBe(true);
  });

  it('o padrão do sistema continua sendo o de sempre', () => {
    expect(SYSTEM_CHECKLIST.items[0]).toEqual({ key: 'lights', label: 'Faróis e lanternas' });
    expect(SYSTEM_CHECKLIST.items).toHaveLength(12);
  });
});
