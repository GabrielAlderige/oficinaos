import { PgBoss } from 'pg-boss';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../config/env';
import type { AutomationsService } from '../modules/automations/automations.service';

/** A fila das automações diárias (E21). */
export const FILA_DIARIA = 'automations-tick';

export interface Worker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Trabalhador de fundo (V3, E21), em cima do **pg-boss**: fila no próprio
 * Postgres, sem serviço novo para manter. Ele acorda **de hora em hora** e
 * pergunta a cada oficina se já está na hora dela — é assim que uma oficina
 * em Manaus e outra em São Paulo recebem o resumo às 8 da manhã DELAS.
 *
 * Quem decide o que roda é o `AutomationsService`; aqui só existe o relógio,
 * a garantia de instância única (`singletonKey`) e o desligamento limpo.
 */
export function createWorker(deps: {
  env: Env;
  log: FastifyBaseLogger;
  automations: AutomationsService;
}): Worker {
  let boss: PgBoss | null = null;

  return {
    async start() {
      if (!deps.env.JOBS_ENABLED) {
        deps.log.info('automações: trabalhador desligado (JOBS_ENABLED=false)');
        return;
      }
      // `migrate: false`: quem cria e migra a fila é a DONA, junto das migrations
      // (scripts/migrate.ts). A role que atende requisição não tem — e não
      // deve ter — poder de criar tabela.
      boss = new PgBoss({ connectionString: deps.env.DATABASE_URL, schema: 'pgboss', migrate: false });
      boss.on('error', (erro: unknown) => deps.log.error({ err: erro }, 'pg-boss'));
      await boss.start();
      await boss.createQueue(FILA_DIARIA);

      await boss.work(FILA_DIARIA, async () => {
        const resultado = await deps.automations.tick();
        deps.log.info(resultado, 'automações: volta concluída');
      });

      // de hora em hora, com trava de instância: duas cópias da API não
      // disparam a mesma volta duas vezes
      await boss.schedule(FILA_DIARIA, '0 * * * *', undefined, { singletonKey: FILA_DIARIA });
      deps.log.info('automações: trabalhador no ar (de hora em hora)');
    },

    async stop() {
      // `graceful` espera a volta em andamento terminar: matar no meio deixa
      // metade das oficinas sem a fila do dia
      await boss?.stop({ graceful: true });
      boss = null;
    },
  };
}
