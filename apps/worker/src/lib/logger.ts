import pino from 'pino';

export const WORKER_INSTANCE_ID = `worker-${process.env.HOSTNAME ?? 'local'}-${process.pid}`;

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  base: {
    workerInstanceId: WORKER_INSTANCE_ID,
  },
});