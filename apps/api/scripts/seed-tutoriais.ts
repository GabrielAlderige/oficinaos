/**
 * Cadastra (ou atualiza) as aulas do curso de tutoriais e as publica.
 *
 *   npm run db:seed:tutoriais
 *
 * Os vídeos NÃO moram no git (são 163 MB): ficam na pasta `tutoriais/` ao lado
 * do docker-compose no servidor, e o Caddy serve em `/tutoriais/*` no domínio
 * do painel. A aula aponta para `${TUTORIAIS_URL}/<arquivo>`; sem a variável,
 * vale `${APP_URL}/tutoriais`. A lista de aulas está em `tutoriais-aulas.ts`, gerada
 * junto com os vídeos.
 *
 * Idempotente: roda de novo e só atualiza título, descrição, ordem e vídeo pelo
 * `slug`. Aula que alguém despublicou à mão volta publicada — o curso inteiro
 * existe gravado.
 */
import { sql } from 'drizzle-orm';
import { TUTORIAL_MODULES } from '@oficinaos/shared';
import { loadEnv } from '../src/config/load-env';
import { createDatabase } from '../src/db/client';
import { tutorialLessons } from '../src/db/schema';
import { AULAS_DO_CURSO } from './tutoriais-aulas';

loadEnv();

async function main(): Promise<void> {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error('Falta DATABASE_OWNER_URL no .env');
  const base = (process.env.TUTORIAIS_URL ?? `${process.env.APP_URL ?? ''}/tutoriais`).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Defina TUTORIAIS_URL (ou APP_URL) com o endereço do painel');

  const aulas = AULAS_DO_CURSO;
  for (const aula of aulas) {
    if (!TUTORIAL_MODULES.includes(aula.module)) throw new Error(`Módulo desconhecido em ${aula.slug}: ${aula.module}`);
  }

  const { db, pool } = createDatabase(url, { max: 1 });
  try {
    for (const aula of aulas) {
      const dados = {
        module: aula.module,
        title: aula.title,
        description: aula.description,
        player: 'ARQUIVO' as const,
        videoUrl: `${base}/${aula.file}`,
        durationSeconds: aula.durationSeconds,
        position: aula.position,
      };
      await db
        .insert(tutorialLessons)
        .values({ slug: aula.slug, ...dados, publishedAt: new Date() })
        .onConflictDoUpdate({
          target: tutorialLessons.slug,
          set: {
            ...dados,
            publishedAt: sql`coalesce(${tutorialLessons.publishedAt}, now())`,
            updatedAt: new Date(),
          },
        });
    }
    console.log(`${aulas.length} aulas publicadas, vídeos em ${base}/`);
  } finally {
    await pool.end();
  }
}

await main();
