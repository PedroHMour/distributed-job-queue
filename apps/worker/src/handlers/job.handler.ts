import type { Job } from 'bullmq';
import { logger, WORKER_INSTANCE_ID } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import {
  markJobActive,
  markJobCompleted,
  markJobRetrying,
  markJobDead,
  type FailureRecord,
} from '../lib/job-state.js';
import { processEmailDelivery, type EmailJobData } from '../processors/email.processor.js';
import { processImageProcessing, type ImageJobData } from '../processors/image.processor.js';
import { processReportGeneration, type ReportJobData } from '../processors/report.processor.js';
import { JOB_TYPES } from '@jobqueue/shared';

export async function handleJob(job: Job): Promise<void> {
  const { jobExecutionId } = job.data as { jobExecutionId: string };
  const startedAt = new Date();

  if (!jobExecutionId) {
    logger.error(
      { bullmqJobId: job.id, jobName: job.name },
      'Job sem jobExecutionId — descartando sem retry'
    );
    return;
  }

  logger.info(
    { jobExecutionId, bullmqJobId: job.id, jobType: job.name, attempt: job.attemptsMade + 1 },
    'Worker recebeu job'
  );

  try {
    await markJobActive(jobExecutionId);
  } catch (dbError) {
    logger.error({ err: dbError, jobExecutionId }, 'Falha ao marcar job como ACTIVE');
    throw dbError;
  }

  // CORREÇÃO: Utilizando um tipo flexível para o output payload antes do db
  let outputPayload: Record<string, any>;

  try {
    switch (job.name) {
      case JOB_TYPES.EMAIL_DELIVERY:
        outputPayload = await processEmailDelivery(job as Job<EmailJobData>);
        break;
      case JOB_TYPES.IMAGE_PROCESSING:
        outputPayload = await processImageProcessing(job as Job<ImageJobData>);
        break;
      case JOB_TYPES.REPORT_GENERATION:
        outputPayload = await processReportGeneration(job as Job<ReportJobData>);
        break;
      default:
        logger.error({ jobName: job.name, jobExecutionId }, 'Tipo de job desconhecido');
        await markJobDead(jobExecutionId, job.id!, new Error(`Unknown job type: ${job.name}`), []);
        return;
    }
  } catch (processingError) {
    await handleProcessingFailure(job, jobExecutionId, processingError as Error);
    throw processingError;
  }

  try {
    // A tipagem aqui reflete o que o job-state precisa receber.
    await markJobCompleted(jobExecutionId, startedAt, outputPayload);
    logger.info(
      { jobExecutionId, bullmqJobId: job.id, durationMs: Date.now() - startedAt.getTime() },
      'Job concluído com sucesso'
    );
  } catch (dbError) {
    logger.error(
      { err: dbError, jobExecutionId },
      'CRÍTICO: job processado com sucesso mas falhou ao marcar COMPLETED no Postgres'
    );
  }
}

async function handleProcessingFailure(
  job: Job,
  jobExecutionId: string,
  error: Error
): Promise<void> {
  const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 3);
  const attemptNumber = job.attemptsMade + 1;

  logger.warn(
    {
      jobExecutionId,
      bullmqJobId: job.id,
      jobType: job.name,
      attempt: attemptNumber,
      maxAttempts: job.opts.attempts,
      isLastAttempt,
      error: error.message,
    },
    isLastAttempt ? 'Job esgotou tentativas — movendo para DLQ' : 'Job falhou — será reprocessado'
  );

  if (isLastAttempt) {
    const existingRecord = await prisma.jobExecution.findUnique({
      where: { id: jobExecutionId },
      select: { errorMessage: true, attemptNumber: true },
    });

    const failureHistory: FailureRecord[] = [];

    for (let i = 1; i < attemptNumber; i++) {
      failureHistory.push({
        attempt: i,
        errorMessage: existingRecord?.errorMessage ?? 'Erro anterior não registrado',
        failedAt: new Date().toISOString(),
      });
    }

    failureHistory.push({
      attempt: attemptNumber,
      errorMessage: error.message,
      errorStack: error.stack,
      failedAt: new Date().toISOString(),
    });

    await markJobDead(jobExecutionId, job.id!, error, failureHistory);
  } else {
    await markJobRetrying(jobExecutionId, attemptNumber, error);
  }
}