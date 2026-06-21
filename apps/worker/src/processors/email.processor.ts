import type { Job } from 'bullmq';
import type { EmailDeliveryPayload } from '@jobqueue/shared';
import { logger } from '../lib/logger.js';

export interface EmailJobData extends EmailDeliveryPayload {
  jobExecutionId: string;
}

export interface EmailProcessorResult {
  messageId: string;
  provider: string;
  deliveredAt: string;
  recipientDomain: string;
}

/**
 * Simula envio de e-mail via SMTP externo.
 * - Latência: 200ms – 1.5s (I/O bound realista)
 * - Taxa de falha: 20% (simula SMTP timeout, bounce, rate limit)
 */
export async function processEmailDelivery(
  job: Job<EmailJobData>
): Promise<EmailProcessorResult> {
  const { jobExecutionId, to, subject, templateId, variables } = job.data;

  logger.info(
    { jobExecutionId, to, templateId, attempt: job.attemptsMade },
    'Iniciando envio de e-mail'
  );

  // Simula latência de I/O (chamada a SMTP externo)
  const latencyMs = 200 + Math.random() * 1300;
  await sleep(latencyMs);

  // 20% de chance de falha — simula instabilidade de SMTP
  if (Math.random() < 0.2) {
    const errors = [
      'SMTP connection timeout after 1200ms',
      'Recipient address rejected: user unknown',
      'Too many connections from your IP (rate limited)',
      'TLS handshake failed: certificate expired',
    ];
    const message = errors[Math.floor(Math.random() * errors.length)];
    throw new Error(`EmailDeliveryError: ${message}`);
  }

  const domain = to.split('@')[1];
  const result: EmailProcessorResult = {
    messageId: `msg-${crypto.randomUUID()}`,
    provider: 'smtp.sendgrid.net',
    deliveredAt: new Date().toISOString(),
    recipientDomain: domain,
  };

  logger.info(
    { jobExecutionId, messageId: result.messageId, latencyMs: Math.round(latencyMs) },
    'E-mail entregue com sucesso'
  );

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}