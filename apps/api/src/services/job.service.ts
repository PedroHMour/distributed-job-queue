import type { FastifyBaseLogger } from 'fastify';
import { Queue } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { getQueues } from '../lib/queues.js';
import {
  QUEUE_NAMES,
  JOB_TYPE_CONFIG,
  type JobType,
} from '@jobqueue/shared';
import type { CreateJobInput } from '../schemas/job.schema.js';
import type { JobStatus, JobType as PrismaJobType } from '@prisma/client';

const JOB_TYPE_TO_QUEUE: Record<JobType, string> = {
  EMAIL_DELIVERY:   QUEUE_NAMES.EMAIL_DELIVERY,
  IMAGE_PROCESSING: QUEUE_NAMES.IMAGE_PROCESSING,
  REPORT_GENERATION: QUEUE_NAMES.REPORT_GENERATION,
};

export interface CreateJobResult {
  jobId: string;
  status: string;
  jobType: string;
  enqueuedInRedis: boolean;
  bullmqJobId: string | null;
  message: string;
}

export interface ListJobsParams {
  status?: string;
  jobType?: string;
  limit: number;
  skip: number;
}

/**
 * Cria um novo job:
 * 1. Persiste no Postgres com status PENDING (estado autoritativo)
 * 2. Tenta enfileirar no BullMQ/Redis
 * 3. Se Redis falhar, retorna sucesso — job está salvo e será reenfileirado depois
 */
export async function createJob(
  input: CreateJobInput,
  logger: FastifyBaseLogger
): Promise<CreateJobResult> {
  const jobTypeConfig = JOB_TYPE_CONFIG[input.type];
  const queueName = JOB_TYPE_TO_QUEUE[input.type];

  // Passo 1: Postgres — se falhar aqui, o erro sobe como 500 (correto)
  const jobExecution = await prisma.jobExecution.create({
    data: {
      jobType: input.type as PrismaJobType,
      status: 'PENDING' as JobStatus,
      priority: input.priority ?? jobTypeConfig.priority,
      inputPayload: input.data as object,
      maxAttempts: 3,
    },
  });

  // Passo 2: Redis — se falhar aqui, NÃO é fatal
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
        jobId: jobExecution.id,
      }
    );

    bullmqJobId = bullJob.id ?? null;
    enqueuedInRedis = true;

    await prisma.jobExecution.update({
      where: { id: jobExecution.id },
      data: { bullmqJobId: bullJob.id },
    });
  } catch (redisError) {
    logger.error(
      {
        err: redisError,
        jobExecutionId: jobExecution.id,
        jobType: input.type,
      },
      'Falha ao enfileirar no BullMQ — job persistido no Postgres para reprocessamento'
    );
  }

  return {
    jobId: jobExecution.id,
    status: 'PENDING',
    jobType: input.type,
    enqueuedInRedis,
    bullmqJobId,
    message: enqueuedInRedis
      ? 'Job accepted and queued for immediate processing.'
      : 'Job accepted and persisted. Will be queued automatically soon.',
  };
}

/**
 * Busca um job por ID.
 * Retorna null se não encontrado — a rota decide o status HTTP.
 */
export async function getJobById(id: string) {
  return prisma.jobExecution.findUnique({
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
    },
  });
}

/**
 * Lista jobs com filtros e paginação.
 * Retorna dados + total para o cliente construir paginação.
 */
export async function listJobs(params: ListJobsParams) {
  const { status, jobType, limit, skip } = params;

  const where = {
    ...(status   && { status:  status  as JobStatus }),
    ...(jobType  && { jobType: jobType as PrismaJobType }),
  };

  const [jobs, total] = await Promise.all([
    prisma.jobExecution.findMany({
      where,
      orderBy: { enqueuedAt: 'desc' },
      take: limit,
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
    prisma.jobExecution.count({ where }),
  ]);

  return { data: jobs, total, take: limit, skip };
}