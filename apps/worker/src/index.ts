import { Worker } from 'bullmq';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { handleJob } from './handlers/job.handler.js';
import { getRedisConfig, QUEUE_NAMES } from '@jobqueue/shared';

// Concorrência por tipo de job — decisão arquitetural central:
// EMAIL: alto (I/O bound — o worker fica ocioso esperando SMTP, pode paralelizar muito)
// IMAGE: baixo (CPU bound — mais workers = mais contenção de CPU, piora o throughput)
// REPORT: médio (misto — query pesada + geração de arquivo)
const CONCURRENCY = {
  [QUEUE_NAMES.EMAIL_DELIVERY]:   Number(process.env.CONCURRENCY_EMAIL   ?? 10),
  [QUEUE_NAMES.IMAGE_PROCESSING]: Number(process.env.CONCURRENCY_IMAGE   ?? 2),
  [QUEUE_NAMES.REPORT_GENERATION]:Number(process.env.CONCURRENCY_REPORT  ?? 5),
};

async function bootstrap(): Promise<void> {
  logger.info({ queues: Object.keys(CONCURRENCY) }, 'Iniciando workers');

  // Conecta ao Postgres antes de aceitar qualquer job
  try {
    await prisma.$connect();
    logger.info('Postgres conectado');
  } catch (err) {
    logger.fatal({ err }, 'Não foi possível conectar ao Postgres — abortando');
    process.exit(1);
    // Diferente da API, o worker NÃO sobe em modo degradado sem Postgres.
    // Sem banco, não há como registrar estado — processar seria perda silenciosa.
  }

  const connection = getRedisConfig();

  // Cria um Worker BullMQ por fila, cada um com sua concorrência específica
  const workers = Object.entries(CONCURRENCY).map(([queueName, concurrency]) => {
    const worker = new Worker(queueName, handleJob, {
      connection,
      concurrency,
      // Tempo máximo que um job pode ficar preso em ACTIVE antes de ser considerado stalled
      // Crítico para containers que morrem sem graceful shutdown
      stalledInterval: 30_000,
      maxStalledCount: 2, // após 2 stalls, marca como falha definitiva
    });

    worker.on('completed', (job) => {
      logger.info(
        { bullmqJobId: job.id, jobType: job.name, queue: queueName },
        'BullMQ: job completed'
      );
    });

    worker.on('failed', (job, err) => {
      logger.error(
        { bullmqJobId: job?.id, jobType: job?.name, queue: queueName, err: err.message },
        'BullMQ: job failed'
      );
    });

    worker.on('stalled', (jobId) => {
      logger.warn({ bullmqJobId: jobId, queue: queueName }, 'BullMQ: job stalled — possível crash do worker');
    });

    worker.on('error', (err) => {
      // Erros de conexão com o Redis — o worker vai tentar reconectar automaticamente
      logger.error({ err, queue: queueName }, 'BullMQ Worker error (conexão Redis)');
    });

    logger.info({ queue: queueName, concurrency }, 'Worker iniciado');
    return worker;
  });

  // Graceful shutdown — espera jobs em andamento terminarem antes de sair
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Sinal recebido — iniciando graceful shutdown');

    try {
      // Pausa todos os workers: param de pegar novos jobs mas terminam os em andamento
      await Promise.all(workers.map((w) => w.pause()));
      logger.info('Workers pausados — aguardando jobs em andamento terminarem');

      // Fecha os workers (aguarda processamento atual + fecha conexão Redis)
      await Promise.all(workers.map((w) => w.close()));
      logger.info('Todos os workers fechados');

      await prisma.$disconnect();
      logger.info('Postgres desconectado — shutdown concluído');

      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Mantém o processo vivo (workers são event-driven, sem loop explícito)
  logger.info(
    {
      concurrency: CONCURRENCY,
      pid: process.pid,
    },
    'Todos os workers ativos e escutando filas'
  );
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao inicializar workers');
  process.exit(1);
});