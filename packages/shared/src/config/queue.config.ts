import type { DefaultJobOptions } from 'bullmq';

export const QUEUE_NAMES = {
  EMAIL_DELIVERY: 'email-delivery',
  IMAGE_PROCESSING: 'image-processing',
  REPORT_GENERATION: 'report-generation',
  DEAD_LETTER: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Configuração base de retry com backoff exponencial
// Não use intervalos fixos em produção — eles causam thundering herd
export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000, // 1s → 2s → 4s
  },
  removeOnComplete: {
    age: 3600,  // remove do Redis após 1h (o registro permanente está no Postgres)
    count: 100, // mantém no máximo os últimos 100 completos por fila
  },
  removeOnFail: {
    age: 24 * 3600, // falhas ficam 24h no Redis para debugging
  },
};

// Configurações específicas por tipo — CPU bound tem timeout maior
export const JOB_TYPE_CONFIG = {
  EMAIL_DELIVERY: {
    priority: 1,      // maior prioridade
    timeout: 30_000,  // 30s — depende de SMTP externo
  },
  IMAGE_PROCESSING: {
    priority: 2,
    timeout: 120_000, // 2min — CPU bound
  },
  REPORT_GENERATION: {
    priority: 3,      // menor prioridade
    timeout: 180_000, // 3min — I/O pesado + dados
  },
} as const; 