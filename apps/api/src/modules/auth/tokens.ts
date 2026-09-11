import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';

/** 256 bits aleatórios em base64url: refresh token, reset de senha, convite. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** O banco só guarda o hash: um vazamento do banco não entrega tokens válidos. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface AccessClaims {
  userId: string;
  organizationId: string;
  sessionId: string;
}

const ISSUER = 'oficinaos';
const AUDIENCE = 'oficinaos-web';

/**
 * Access token: JWT HS256 de 15 min. Claims mínimas (usuário, oficina, sessão).
 * Sem papel, nome ou e-mail: o papel é lido do banco a cada requisição.
 */
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ org: claims.organizationId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const { sub, org, sid } = payload as { sub?: unknown; org?: unknown; sid?: unknown };
      if (typeof sub !== 'string' || typeof org !== 'string' || typeof sid !== 'string') return null;
      return { userId: sub, organizationId: org, sessionId: sid };
    } catch {
      return null;
    }
  }
}
