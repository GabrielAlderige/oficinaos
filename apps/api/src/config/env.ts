import { z } from 'zod';

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'precisa ser uma URL postgres://usuario:senha@host:porta/banco');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Origens do painel autorizadas no CORS, separadas por vírgula. */
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Endereço público do painel: base dos links de e-mail (redefinir senha, convite). */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Conexão da aplicação: role oficinaos_app, sujeita ao RLS. */
  DATABASE_URL: postgresUrl,
  /** Assina o access token (HS256). Nunca vai para o front. */
  JWT_SECRET: z.string().min(32, 'precisa ter pelo menos 32 caracteres'),
  /** console = imprime o e-mail no terminal (dev); memory = guarda em memória (testes). */
  EMAIL_DRIVER: z.enum(['console', 'memory']).default('console'),
  /**
   * Onde ficam as fotos do check-in e os anexos da OS (ARCHITECTURE §11).
   * disk   = pasta local, servida pela própria API com URL assinada (dev)
   * memory = em memória (testes)
   * S3/R2 entram como driver novo quando houver deploy, sem mexer no domínio.
   */
  STORAGE_DRIVER: z.enum(['disk', 'memory']).default('disk'),
  /** Pasta do driver disk, relativa à raiz do repositório. Fica fora do git. */
  STORAGE_DIR: z.string().default('storage'),
  /**
   * Emissor de nota fiscal (E18). `simulador` NÃO emite nota: devolve uma
   * resposta marcada como simulação, para a oficina conferir o fluxo antes de
   * contratar o emissor. Driver real entra aqui quando houver credencial.
   */
  FISCAL_DRIVER: z.enum(['simulador']).default('simulador'),
  /** Teto por arquivo. O painel comprime a foto no aparelho antes de enviar (~300 KB). */
  /**
   * Liga o provider FALSO de pesquisa de peças (E14). Desligado por padrão, de
   * propósito: preço inventado ao lado de preço real confunde, mesmo com selo.
   * Serve para desenvolver a tela sem lista de preço importada.
   */
  PARTS_SEARCH_MOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform((valor) => valor === 'true'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

/** Valida o ambiente no boot. Faltou variável, a API não sobe (e diz qual). */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${issues}`);
  }
  return parsed.data;
}
