import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { AUTOMATION_KEYS } from '@oficinaos/shared';
import { id, timestamps, timestamptz } from './_columns';
import { organizations } from './tenancy';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(','));

/**
 * O que cada oficina deixou ligado nas automações (V3, E21).
 *
 * A linha só nasce quando a oficina mexe: sem linha, valem os padrões do
 * `AUTOMATION_DEFAULTS`. É o mesmo desenho dos dados fiscais (E18) — tabela
 * vazia significa "ninguém configurou", não "está tudo desligado".
 */
export const automationSettings = pgTable(
  'automation_settings',
  {
    organizationId: uuid()
      .primaryKey()
      .references(() => organizations.id),
    followUpQueue: boolean().notNull().default(true),
    appointmentReminder: boolean().notNull().default(true),
    quoteNoAnswer: boolean().notNull().default(true),
    /** desligado por padrão: e-mail que ninguém pediu é spam */
    dailyDigest: boolean().notNull().default(false),
    runHour: integer().notNull().default(8),
    quoteNoAnswerDays: integer().notNull().default(3),
    digestEmail: text(),
    ...timestamps,
  },
  (t) => [
    check('automation_run_hour_check', sql`${t.runHour} between 0 and 23`),
    check('automation_no_answer_days_check', sql`${t.quoteNoAnswerDays} between 1 and 30`),
  ],
);

/**
 * O que aconteceu em cada execução. Existe para a oficina poder perguntar
 * "isso rodou hoje?" e receber uma resposta — automação sem registro é
 * promessa, e promessa não se audita.
 */
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    key: text({ enum: AUTOMATION_KEYS }).notNull(),
    ranAt: timestamptz().notNull().defaultNow(),
    /** o dia no relógio da OFICINA: é ele que garante "uma vez por dia" */
    ranOn: text().notNull(),
    created: integer().notNull().default(0),
    durationMs: integer().notNull().default(0),
    error: text(),
  },
  (t) => [
    index('automation_runs_org_idx').on(t.organizationId, t.key, t.ranAt.desc()),
    check('automation_runs_key_check', sql`${t.key} in (${list(AUTOMATION_KEYS)})`),
  ],
);
