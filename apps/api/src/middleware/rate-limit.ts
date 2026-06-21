import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Rate limiter em memória por IP.
 * Janela fixa de 60 segundos com limite configurável via env.
 *
 * Limitações intencionais (adequadas para portfólio/single-node):
 * - Estado em memória: não compartilhado entre réplicas da API.
 * - Em produção com múltiplas instâncias, usar Redis como store centralizado
 *   (ex: @fastify/rate-limit com store Redis).
 *
 * O map é limpo a cada 5 minutos para evitar crescimento indefinido.
 */

const WINDOW_MS = 60_000; // 1 minuto
const MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX ?? 100);

const store = new Map<string, RateLimitEntry>();

// Limpeza periódica de entradas expiradas
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store.entries()) {
    if (entry.resetAt < now) {
      store.delete(ip);
    }
  }
}, 5 * 60_000);

export function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const ip = request.ip;
  const now = Date.now();

  const entry = store.get(ip);

  if (!entry || entry.resetAt < now) {
    // Primeira requisição ou janela expirada — reseta o contador
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return done();
  }

  entry.count += 1;

  if (entry.count > MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

    reply
      .status(429)
      .header('Retry-After', String(retryAfterSec))
      .header('X-RateLimit-Limit', String(MAX_REQUESTS))
      .header('X-RateLimit-Remaining', '0')
      .header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
      .send({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`,
        retryAfter: retryAfterSec,
      });
    return;
  }

  // Injeta headers informativos em todas as respostas dentro do limite
  reply
    .header('X-RateLimit-Limit', String(MAX_REQUESTS))
    .header('X-RateLimit-Remaining', String(MAX_REQUESTS - entry.count))
    .header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

  done();
}