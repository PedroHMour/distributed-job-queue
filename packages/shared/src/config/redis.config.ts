import type { RedisOptions } from 'ioredis';

export function getRedisConfig(): RedisOptions {
  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    // Reconexão automática com backoff — crítico para resiliência
    retryStrategy: (times: number) => {
      if (times > 10) {
        // Após 10 tentativas, deixa o processo morrer para o Docker reiniciar
        return null;
      }
      return Math.min(times * 200, 2000); // máx 2s entre tentativas
    },
    // Mantém a conexão viva — necessário para workers de longa duração
    enableReadyCheck: true,
    maxRetriesPerRequest: null, // BullMQ exige null aqui
    lazyConnect: false,
  };
}