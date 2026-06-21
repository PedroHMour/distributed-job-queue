import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { jobsRoute } from './routes/jobs.route.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { prisma } from './lib/prisma.js';
import { closeQueues, getQueues } from './lib/queues.js';
import { QUEUE_NAMES } from '@jobqueue/shared';

const PORT = Number(process.env.API_PORT ?? 3000);
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    genReqId: () => crypto.randomUUID(),
  });

  await fastify.register(sensible);
  registerErrorHandler(fastify);
  await fastify.register(jobsRoute, { prefix: '/api/v1' });

  fastify.get('/health', async (_request, reply) => {
    const [dbOk, redisOk] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      getQueues()[QUEUE_NAMES.EMAIL_DELIVERY].getJobCounts(),
    ]);

    const status = {
      postgres: dbOk.status === 'fulfilled' ? 'ok' : 'degraded',
      redis:    redisOk.status === 'fulfilled' ? 'ok' : 'degraded',
    };

    const httpStatus = status.postgres === 'degraded' ? 503 : 200;
    return reply.status(httpStatus).send({ status, uptime: process.uptime() });
  });

  const shutdown = async (signal: string) => {
    fastify.log.info(`Recebido ${signal} — iniciando shutdown gracioso`);
    try {
      await fastify.close();
      await closeQueues();
      await prisma.$disconnect();
      fastify.log.info('Shutdown concluído.');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  try {
    await prisma.$connect();
    fastify.log.info('Postgres conectado.');
  } catch (err) {
    fastify.log.error({ err }, 'Não foi possível conectar ao Postgres na inicialização');
  }

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`API rodando em http://${HOST}:${PORT}`);
}

bootstrap().catch((err) => {
  console.error('Falha fatal ao inicializar a API:', err);
  process.exit(1);
});