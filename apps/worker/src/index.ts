import { Worker } from 'bullmq';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { handleJob } from './handlers/job.handler.js';
import { getRedisConfig, QUEUE_NAMES } from '@jobqueue/shared';
import { startLivenessProbe, stopLivenessProbe } from './health/liveness.js';

const CONCURRENCY = {
  [QUEUE_NAMES.EMAIL_DELIVERY]:    Number(process.env.CONCURRENCY_EMAIL  ?? 10),
  [QUEUE_NAMES.IMAGE_PROCESSING]:  Number(process.env.CONCURRENCY_IMAGE  ?? 2),
  [QUEUE_NAMES.REPORT_GENERATION]: Number(process.env.CONCURRENCY_REPORT ?? 5),
};

async function bootstrap(): Promise<void> {
  logger.info({ queues: Object.keys(CONCURRENCY) }, 'Iniciando workers');

  try {
    await prisma.$connect();
    logger.info('Postgres conectado');
  } catch (err) {
    logger.fatal({ err }, 'Não foi possível conectar ao Postgres — abortando');
    process.exit(1);
  }

  // Inicia o liveness probe antes de aceitar qualquer job
  startLivenessProbe();

  const connection = getRedisConfig();

  const workers = Object.entries(CONCURRENCY).map(([queueName, concurrency]) => {
    const worker = new Worker(queueName, handleJob, {
      connection,
      concurrency,
      stalledInterval: 30_000,
      maxStalledCount: 2,
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
      logger.warn(
        { bullmqJobId: jobId, queue: queueName },
        'BullMQ: job stalled — possível crash do worker'
      );
    });

    worker.on('error', (err) => {
      logger.error({ err, queue: queueName }, 'BullMQ Worker error (conexão Redis)');
    });

    logger.info({ queue: queueName, concurrency }, 'Worker iniciado');
    return worker;
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Sinal recebido — iniciando graceful shutdown');

    try {
      stopLivenessProbe();
      await Promise.all(workers.map((w) => w.pause()));
      logger.info('Workers pausados — aguardando jobs em andamento terminarem');
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

  logger.info({ concurrency: CONCURRENCY, pid: process.pid }, 'Todos os workers ativos e escutando filas');
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Falha fatal ao inicializar workers');
  process.exit(1);
});