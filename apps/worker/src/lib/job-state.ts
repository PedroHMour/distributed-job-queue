import { prisma } from './prisma.js';
import { logger, WORKER_INSTANCE_ID } from './logger.js';

export interface FailureRecord {
  attempt: number;
  errorMessage: string;
  errorStack?: string;
  failedAt: string;
}

export async function markJobActive(jobExecutionId: string): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'ACTIVE',
      startedAt: new Date(),
      workerInstanceId: WORKER_INSTANCE_ID,
    },
  });
}

export async function markJobCompleted(
  jobExecutionId: string,
  startedAt: Date,
  outputPayload: Record<string, any> // CORREÇÃO AQUI
): Promise<void> {
  const completedAt = new Date();
  const processingMs = completedAt.getTime() - startedAt.getTime();

  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'COMPLETED',
      completedAt,
      processingMs,
      outputPayload,
    },
  });
}

export async function markJobRetrying(
  jobExecutionId: string,
  attemptNumber: number,
  error: Error
): Promise<void> {
  await prisma.jobExecution.update({
    where: { id: jobExecutionId },
    data: {
      status: 'RETRYING',
      attemptNumber,
      errorMessage: error.message,
      errorStack: error.stack,
    },
  });
}

export async function markJobDead(
  jobExecutionId: string,
  bullmqJobId: string,
  error: Error,
  failureHistory: FailureRecord[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const deadJob = await tx.jobExecution.update({
      where: { id: jobExecutionId },
      data: {
        status: 'DEAD',
        completedAt: new Date(),
        errorMessage: error.message,
        errorStack: error.stack,
      },
    });

    await tx.deadLetterEntry.create({
      data: {
        jobExecutionId: deadJob.id,
        bullmqJobId,
        jobType: deadJob.jobType,
        inputPayload: deadJob.inputPayload as object,
        // Conversão garantida para o Prisma processar como JSON array
        failureHistory: failureHistory as unknown as object[], 
      },
    });
  });

  logger.error(
    { jobExecutionId, bullmqJobId, attempts: failureHistory.length },
    'Job movido para Dead Letter Queue'
  );
}