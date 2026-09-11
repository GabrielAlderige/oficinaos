/** Parâmetros da sessão (ARCHITECTURE §6). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Duas abas renovando juntas: o token anterior ainda vale por esta janela. */
export const REFRESH_REUSE_GRACE_MS = 30_000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Mudança de papel ou desativação vale em até este tempo em outras instâncias da API. */
export const AUTH_CACHE_TTL_MS = 30_000;

export const REFRESH_COOKIE = 'oos_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
