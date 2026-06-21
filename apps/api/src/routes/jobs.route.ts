import type { FastifyPluginAsync } from 'fastify';
import { CreateJobSchema } from '../schemas/job.schema.js';
import { createJob, getJobById, listJobs } from '../services/job.service.js';

export const jobsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/jobs', async (request, reply) => {
    const parseResult = CreateJobSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Payload inválido',
        issues: parseResult.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const result = await createJob(parseResult.data, fastify.log);
    return reply.status(202).send(result);
  });

  fastify.get<{ Params: { id: string } }>(
    '/jobs/:id',
    async (request, reply) => {
      const job = await getJobById(request.params.id);

      if (!job) {
        return reply.status(404).send({ error: 'Job não encontrado' });
      }

      return reply.send(job);
    }
  );

  fastify.get<{
    Querystring: {
      status?: string;
      jobType?: string;
      limit?: string;
      offset?: string;
    };
  }>('/jobs', async (request, reply) => {
    const { status, jobType, limit = '20', offset = '0' } = request.query;

    const result = await listJobs({
      status,
      jobType,
      limit: Math.min(Number(limit), 100),
      skip: Number(offset),
    });

    return reply.send(result);
  });
};