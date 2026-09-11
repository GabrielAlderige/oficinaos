import { z } from 'zod';

/**
 * Senhas comuns o bastante para caírem no primeiro chute. Lista curta, de
 * propósito: pega o óbvio sem baixar nada. Orientação NIST 800-63B: tamanho
 * mínimo + recusar senha conhecida, sem exigir "símbolo e maiúscula".
 */
const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '12341234', '87654321', '11111111', '00000000',
  '12121212', '123123123', 'password', 'password1', 'passw0rd', 'senha123', 'senha1234',
  'senhasenha', 'minhasenha', 'mudar123', 'trocar123', 'admin123', 'administrador',
  'qwerty123', 'qwertyui', 'asdfghjk', 'abc12345', 'abcd1234', '1q2w3e4r', '1qaz2wsx',
  'zaq12wsx', 'iloveyou', 'sunshine', 'princesa', 'changeme', 'welcome1', 'brasil123',
  'oficina123', 'mecanica123', 'flamengo', 'corinthians', 'palmeiras', 'saopaulo',
  'vasco123', 'gremio123', 'cruzeiro', 'botafogo', 'fluminense',
]);

export const passwordSchema = z
  .string()
  .min(8, 'Use pelo menos 8 caracteres')
  .max(128, 'Use no máximo 128 caracteres')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'Essa senha é muito comum. Escolha outra.');
