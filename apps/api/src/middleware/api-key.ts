import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

const API_KEY = process.env.API_KEY;

/**
 * Middleware de autenticação por API Key.
 * Lê o header X-API-Key e rejeita requisições sem chave válida.
 *
 * Em produção, API_KEY deve ser uma string longa gerada aleatoriamente
 * (ex: openssl rand -hex 32) e injetada via variável de ambiente.
 *
 * Se API_KEY não estiver definida no ambiente, o middleware é desativado
 * automaticamente — útil para desenvolvimento local sem .env configurado.
 */
export function apiKeyMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  if (!API_KEY) {
    // Sem chave configurada = ambiente de desenvolvimento, passa tudo
    return done();
  }

  const providedKey = request.headers['x-api-key'];

  if (!providedKey || providedKey !== API_KEY) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Missing or invalid X-API-Key header.',
    });
    return;
  }

  done();
}