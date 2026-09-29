import { index, inet, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { id, timestamptz } from './_columns';
import { organizations, users } from './tenancy';

/**
 * Sessão de login (uma por aparelho). Tabela GLOBAL, sem RLS de tenant: o
 * refresh acontece antes de existir contexto. Por isso a coluna se chama
 * `active_organization_id`, e não `organization_id` (o teste de guarda trata
 * `organization_id` como marca de tabela de tenant). Só o módulo de auth a lê.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    activeOrganizationId: uuid()
      .notNull()
      .references(() => organizations.id),
    /** SHA-256 do refresh token opaco; o token em si nunca é gravado */
    refreshTokenHash: text().notNull().unique(),
    /** token anterior à última rotação: reaparecer fora da tolerância = roubo */
    previousTokenHash: text(),
    rotatedAt: timestamptz(),
    userAgent: text(),
    ip: inet(),
    lastUsedAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    revokedReason: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_previous_token_idx').on(t.previousTokenHash),
  ],
);

/** Redefinição de senha: 30 min, uso único, só o hash é gravado. Global. */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    requestedIp: inet(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
);

/**
 * Confirmação de e-mail (E29): 48 h, uso único, só o hash é gravado. Global,
 * como a redefinição de senha — o link é aberto sem sessão nenhuma.
 *
 * O prazo é longo de propósito: quem se cadastra na quinta à noite confirma no
 * domingo, e um link vencido faz a pessoa achar que o sistema está quebrado.
 */
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    /** o e-mail do momento do envio: trocar de e-mail invalida o link antigo */
    email: text().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    requestedIp: inet(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('email_verification_tokens_user_idx').on(t.userId)],
);
