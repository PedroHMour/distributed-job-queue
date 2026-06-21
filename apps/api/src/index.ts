import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { jobsRoute } from './routes/jobs.route.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { prisma } from './lib/prisma.js';
import { closeQueues } from './lib/queues.js';

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
    // ID único por request — essencial para correlacionar logs em escala
    genReqId: () => crypto.randomUUID(),
  });

  // Plugins do ecossistema Fastify
  await fastify.register(sensible);

  // Error handler global
  registerErrorHandler(fastify);

  // Rotas
  await fastify.register(jobsRoute, { prefix: '/api/v1' });

  // Health check — usado pelo Docker e pelo load balancer
  fastify.get('/health', async () => {
    const [dbOk, redisOk] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      // Verifica Redis tentando listar filas (lightweight)
      import('./lib/queues.js').then(({ getQueues }) => {
        const q = getQueues();
        return Object.values(q)[0].getJobCounts();
      }),
    ]);

    const status = {
      postgres: dbOk.status === 'fulfilled' ? 'ok' : 'degraded',
      redis: redisOk.status === 'fulfilled' ? 'ok' : 'degraded',
    };

    const httpStatus =
      status.postgres === 'degraded' ? 503 : 200;

    return { status, uptime: process.uptime() };
  });

  // Graceful shutdown — crítico para não perder jobs em andamento
  const shutdown = async (signal: string) => {
    fastify.log.info(`Recebido ${signal} — iniciando shutdown gracioso`);

    try {
      await fastify.close();        // para de aceitar novas conexões
      await closeQueues();          // fecha conexões BullMQ com o Redis
      await prisma.$disconnect();   // fecha pool do Postgres
      fastify.log.info('Shutdown concluído.');
      process.exit(0);
    } catch (err) {
      fastify.log.error({ err }, 'Erro durante shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Inicialização com verificação de conexão ao Postgres
  try {
    await prisma.$connect();
    fastify.log.info('Postgres conectado.');
  } catch (err) {
    fastify.log.error({ err }, 'Não foi possível conectar ao Postgres na inicialização');
    // Não abortamos — a API sobe em modo degradado e o error handler cuida dos erros subsequentes
  }

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`API rodando em http://${HOST}:${PORT}`);
}

bootstrap().catch((err) => {
  console.error('Falha fatal ao inicializar a API:', err);
  process.exit(1);
});