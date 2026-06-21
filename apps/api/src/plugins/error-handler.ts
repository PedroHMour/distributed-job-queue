import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error, request, reply) => {
    // Erro de constraint do Prisma (ex: unique violation)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      fastify.log.warn({ err: error, code: error.code }, 'Erro do Prisma');

      if (error.code === 'P2002') {
        return reply.status(409).send({
          error: 'Conflito de dados',
          detail: 'Um registro com esses dados já existe.',
        });
      }

      return reply.status(400).send({
        error: 'Erro de banco de dados',
        code: error.code,
      });
    }

    // Erro de conexão com o banco (Postgres offline)
    if (error instanceof Prisma.PrismaClientInitializationError) {
      fastify.log.error({ err: error }, 'Postgres indisponível');
      return reply.status(503).send({
        error: 'Serviço indisponível',
        detail: 'Banco de dados temporariamente inacessível.',
      });
    }

    // Erros de validação do Fastify (payload malformado, tipo errado)
    if (error.statusCode === 400) {
      return reply.status(400).send({
        error: 'Requisição inválida',
        detail: error.message,
      });
    }

    // Qualquer outro erro — 500 com log completo
    fastify.log.error({ err: error, url: request.url }, 'Erro inesperado');
    return reply.status(500).send({
      error: 'Erro interno do servidor',
      requestId: request.id,
    });
  });
}