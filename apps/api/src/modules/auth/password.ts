import { hash, verify } from '@node-rs/argon2';

// argon2id (padrão da biblioteca) com os parâmetros mínimos da OWASP: 19 MiB, 2 passadas.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Faz o mesmo trabalho de uma verificação real quando o e-mail não existe, para
 * o tempo de resposta do login não revelar quem tem conta.
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('oficinaos-senha-que-nunca-confere');
  await verifyPassword(await dummyHash, plain);
}
