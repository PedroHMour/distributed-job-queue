import { Queue } from 'bullmq';
import {
  QUEUE_NAMES,
  getRedisConfig,
  DEFAULT_JOB_OPTIONS,
  type QueueName,
} from '@jobqueue/shared';

type QueueMap = Record<QueueName, Queue>;

let queues: QueueMap | null = null;

export function getQueues(): QueueMap {
  if (queues) return queues;

  const connection = getRedisConfig();

  queues = {
    [QUEUE_NAMES.EMAIL_DELIVERY]: new Queue(QUEUE_NAMES.EMAIL_DELIVERY, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    [QUEUE_NAMES.IMAGE_PROCESSING]: new Queue(QUEUE_NAMES.IMAGE_PROCESSING, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    [QUEUE_NAMES.REPORT_GENERATION]: new Queue(QUEUE_NAMES.REPORT_GENERATION, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    [QUEUE_NAMES.DEAD_LETTER]: new Queue(QUEUE_NAMES.DEAD_LETTER, {
      connection,
      // Dead letter não precisa de retry — jobs chegam aqui já esgotados
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 3600 },
        removeOnFail: false,
      },
    }),
  };

  return queues;
}

export async function closeQueues(): Promise<void> {
  if (!queues) return;
  await Promise.all(Object.values(queues).map((q) => q.close()));
  queues = null;
}