export * from './types/job.types';
export * from './config/queue.config';
export * from './config/redis.config';

// Re-exporta o PrismaClient para que API e Worker usem a mesma instância tipada
export { PrismaClient } from '@prisma/client';
export type {
  JobExecution,
  DeadLetterEntry,
  JobType as PrismaJobType,
  JobStatus as PrismaJobStatus,
} from '@prisma/client';