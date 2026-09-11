import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Carrega o `.env` da raiz do monorepo (os scripts do npm rodam com cwd em
 * `apps/api`). Variável já definida no ambiente sempre prevalece: é assim que
 * produção e testes sobrescrevem o arquivo.
 */
export function loadEnv(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  const file = candidates.find((path) => existsSync(path));
  if (!file) return;

  const parsed = parseEnv(readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}
