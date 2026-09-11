import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { ROLES } from '@oficinaos/shared';
import { citext, id, timestamps, timestamptz } from './_columns';

export interface Address {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  city?: string;
  state?: string;
}

/** {"mon": [["08:00","12:00"],["13:00","18:00"]], ...} */
export type BusinessHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', [string, string][]>
>;

const roleList = sql.raw(ROLES.map((role) => `'${role}'`).join(','));

/** A oficina. É o tenant: RLS compara `id` com o contexto da transação. */
export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text().notNull(),
    legalName: text(),
    document: text(),
    phone: text(),
    whatsapp: text(),
    email: citext(),
    address: jsonb().$type<Address>(),
    logoKey: text(),
    timezone: text().notNull().default('America/Sao_Paulo'),
    businessHours: jsonb().$type<BusinessHours>(),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text({ enum: ['ACTIVE', 'SUSPENDED'] })
      .notNull()
      .default('ACTIVE'),
    onboardingCompletedAt: timestamptz(),
    ...timestamps,
  },
  (t) => [check('organizations_status_check', sql`${t.status} in ('ACTIVE', 'SUSPENDED')`)],
);

/** Pessoa com login. Global: a mesma pessoa pode estar em várias oficinas. */
export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: citext().notNull().unique(),
  passwordHash: text().notNull(),
  phone: text(),
  emailVerifiedAt: timestamptz(),
  lastLoginAt: timestamptz(),
  isPlatformAdmin: boolean().notNull().default(false),
  deletedAt: timestamptz(),
  ...timestamps,
});

/** Usuário ↔ oficina, com o papel naquela oficina. */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    role: text({ enum: ROLES }).notNull(),
    isActive: boolean().notNull().default(true),
    calendarColor: text(),
    ...timestamps,
  },
  (t) => [
    unique('memberships_organization_user_unique').on(t.organizationId, t.userId),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_check', sql`${t.role} in (${roleList})`),
  ],
);

/**
 * Convite para entrar na equipe. Só o hash do token é gravado; o link inteiro
 * aparece uma vez, na criação. O aceite é público: a policy
 * `invitation_by_token` libera a leitura para quem apresenta o hash.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    email: citext().notNull(),
    role: text({ enum: ROLES }).notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    acceptedByUserId: uuid().references(() => users.id),
    revokedAt: timestamptz(),
    invitedByUserId: uuid().references(() => users.id),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('invitations_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    check('invitations_role_check', sql`${t.role} in (${roleList})`),
  ],
);

/** Numeração humana por oficina (OS nº 182): UPSERT … RETURNING na mesma transação. */
export const organizationCounters = pgTable(
  'organization_counters',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    key: text().notNull(),
    value: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);
