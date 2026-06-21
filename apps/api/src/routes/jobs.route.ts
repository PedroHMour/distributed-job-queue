import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { CreateJobSchema } from '../schemas/job.schema.js';
import { prisma } from '../lib/prisma.js';
import { getQueues } from '../lib/queues.js';
import {
  QUEUE_NAMES,
  JOB_TYPE_CONFIG,
  type JobType,
} from '@jobqueue/shared';

// Mapeia o tipo de job para o nome da fila correspondente
const JOB_TYPE_TO_QUEUE: Record<JobType, string> = {
  EMAIL_DELIVERY: QUEUE_NAMES.EMAIL_DELIVERY,
  IMAGE_PROCESSING: QUEUE_NAMES.IMAGE_PROCESSING,
  REPORT_GENERATION: QUEUE_NAMES.REPORT_GENERATION,
};

export const jobsRoute: FastifyPluginAsync = async (fastify) => {
  // POST /jobs — ingestão principal
  fastify.post('/jobs', async (request, reply) => {
    // 1. Validação do payload com Zod
    const parseResult = CreateJobSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Payload inválido',
        issues: parseResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const input = parseResult.data;
    const jobTypeConfig = JOB_TYPE_CONFIG[input.type];
    const queueName = JOB_TYPE_TO_QUEUE[input.type];

    // 2. Persistência no Postgres — estado autoritativo
    // Se isso falhar, retornamos 500 genuíno (sem job salvo = nada a processar)
    const jobExecution = await prisma.jobExecution.create({
      data: {
        jobType: input.type,
        status: 'PENDING',
        priority: input.priority ?? jobTypeConfig.priority,
        inputPayload: input.data as object,
        maxAttempts: 3,
      },
    });

    // 3. Tentativa de enfileiramento no BullMQ
    // Isolado em try/catch — falha aqui NÃO é fatal, job já está no Postgres
    let bullmqJobId: string | null = null;
    let enqueuedInRedis = false;

    try {
      const queues = getQueues();
      const queue = queues[queueName as keyof typeof queues] as Queue;

      const bullJob = await queue.add(
        input.type,
        {
          jobExecutionId: jobExecution.id,
          ...input.data,
        },
        {
          priority: input.priority ?? jobTypeConfig.priority,
          jobId: jobExecution.id, // correlação 1:1 com o Postgres
        }
      );

      bullmqJobId = bullJob.id ?? null;
      enqueuedInRedis = true;

      // Atualiza o registro com o ID do BullMQ para rastreabilidade cruzada
      await prisma.jobExecution.update({
        where: { id: jobExecution.id },
        data: { bullmqJobId: bullJob.id },
      });
    } catch (redisError) {
      // Redis offline ou timeout — logar, mas NÃO deixar o request falhar
      // O job está salvo no Postgres com status PENDING.
      // Um cron futuro vai varrê-lo e reinseri-lo na fila.
      fastify.log.error(
        {
          err: redisError,
          jobExecutionId: jobExecution.id,
          jobType: input.type,
        },
        'Falha ao enfileirar no BullMQ — job persistido no Postgres para reprocessamento'
      );
    }

    // 4. Resposta 202 em todos os casos (job salvo com garantia)
    return reply.status(202).send({
      jobId: jobExecution.id,
      status: 'PENDING',
      jobType: input.type,
      enqueuedInRedis,
      bullmqJobId,
      message: enqueuedInRedis
        ? 'Job aceito e enfileirado para processamento imediato.'
        : 'Job aceito e persistido. Será enfileirado automaticamente em breve.',
    });
  });

  // GET /jobs/:id — consulta de status (útil para polling do cliente)
  fastify.get<{ Params: { id: string } }>(
    '/jobs/:id',
    async (request, reply) => {
      const { id } = request.params;

      const job = await prisma.jobExecution.findUnique({
        where: { id },
        select: {
          id: true,
          jobType: true,
          status: true,
          priority: true,
          attemptNumber: true,
          maxAttempts: true,
          enqueuedAt: true,
          startedAt: true,
          completedAt: true,
          processingMs: true,
          workerInstanceId: true,
          errorMessage: true,
          bullmqJobId: true,
          // Omite inputPayload e outputPayload da listagem por segurança
          // (podem conter dados sensíveis como e-mails, URLs privadas)
        },
      });

      if (!job) {
        return reply.status(404).send({ error: 'Job não encontrado' });
      }

      return reply.send(job);
    }
  );

  // GET /jobs — listagem com filtros básicos para demonstração
  fastify.get<{
    Querystring: {
      status?: string;
      jobType?: string;
      limit?: string;
      offset?: string;
    };
  }>('/jobs', async (request, reply) => {
    const {
      status,
      jobType,
      limit = '20',
      offset = '0',
    } = request.query;

    const take = Math.min(Number(limit), 100); // máx 100 por página
    const skip = Number(offset);

    const [jobs, total] = await Promise.all([
      prisma.jobExecution.findMany({
        where: {
          ...(status && { status: status as any }),
          ...(jobType && { jobType: jobType as any }),
        },
        orderBy: { enqueuedAt: 'desc' },
        take,
        skip,
        select: {
          id: true,
          jobType: true,
          status: true,
          priority: true,
          attemptNumber: true,
          enqueuedAt: true,
          completedAt: true,
          processingMs: true,
          workerInstanceId: true,
        },
      }),
      prisma.jobExecution.count({
        where: {
          ...(status && { status: status as any }),
          ...(jobType && { jobType: jobType as any }),
        },
      }),
    ]);

    return reply.send({ data: jobs, total, take, skip });
  });
};