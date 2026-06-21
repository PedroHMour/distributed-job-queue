import type { Job } from 'bullmq';
import type { ReportGenerationPayload } from '@jobqueue/shared';
import { logger } from '../lib/logger.js';

export interface ReportJobData extends ReportGenerationPayload {
  jobExecutionId: string;
}

export interface ReportProcessorResult {
  reportId: string;
  downloadUrl: string;
  rowCount: number;
  fileSizeKb: number;
  generatedAt: string;
  deliveredTo: string;
}

/**
 * Simula geração de relatório: fetch de dados → agregação → upload → envio.
 * - Latência: 1s – 5s total (I/O de banco + geração de arquivo)
 * - Taxa de falha: 25% (banco de dados lento, timeout de query, S3 unavailable)
 */
export async function processReportGeneration(
  job: Job<ReportJobData>
): Promise<ReportProcessorResult> {
  const { jobExecutionId, reportType, dateRange, outputFormat, recipientEmail } = job.data;

  logger.info(
    { jobExecutionId, reportType, dateRange, outputFormat, attempt: job.attemptsMade },
    'Iniciando geração de relatório'
  );

  // Fase 1: Simula query pesada no banco de dados
  const queryLatency = 800 + Math.random() * 2000;
  await sleep(queryLatency);

  if (Math.random() < 0.25) {
    const errors = [
      `QueryTimeout: report query exceeded 3000ms (reportType=${reportType})`,
      `DatabaseError: too many connections — connection pool exhausted`,
      `S3UploadError: write timeout after 5000ms — bucket may be unavailable`,
      `TemplateError: report template '${reportType}-${outputFormat}' not found`,
    ];
    throw new Error(errors[Math.floor(Math.random() * errors.length)]);
  }

  // Fase 2: Simula agregação e geração do arquivo
  const generationLatency = 500 + Math.random() * 1500;
  await sleep(generationLatency);

  // Fase 3: Simula upload para storage e envio ao destinatário
  const uploadLatency = 300 + Math.random() * 700;
  await sleep(uploadLatency);

  const rowCount = Math.round(100 + Math.random() * 9900);
  const fileSizeKb = Math.round(rowCount * 0.8 + Math.random() * 200);
  const reportId = `rpt-${crypto.randomUUID()}`;

  const result: ReportProcessorResult = {
    reportId,
    downloadUrl: `https://reports.internal/download/${reportId}.${outputFormat}`,
    rowCount,
    fileSizeKb,
    generatedAt: new Date().toISOString(),
    deliveredTo: recipientEmail,
  };

  logger.info(
    {
      jobExecutionId,
      reportId,
      rowCount,
      fileSizeKb,
      totalLatencyMs: Math.round(queryLatency + generationLatency + uploadLatency),
    },
    'Relatório gerado e enviado com sucesso'
  );

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}