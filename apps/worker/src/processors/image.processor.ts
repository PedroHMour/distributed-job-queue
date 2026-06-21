import type { Job } from 'bullmq';
import type { ImageProcessingPayload } from '@jobqueue/shared';
import { logger } from '../lib/logger.js';

export interface ImageJobData extends ImageProcessingPayload {
  jobExecutionId: string;
}

export interface ImageProcessorResult {
  outputUrl: string;
  originalSizeKb: number;
  processedSizeKb: number;
  compressionRatio: number;
  operationsApplied: string[];
  processingBackend: string;
}

export async function processImageProcessing(
  job: Job<ImageJobData>
): Promise<ImageProcessorResult> {
  const { jobExecutionId, sourceUrl, operations, outputBucket } = job.data;
  logger.info(
    { jobExecutionId, sourceUrl, operationCount: operations.length, attempt: job.attemptsMade },
    'Iniciando processamento de imagem'
  );

  const operationsApplied: string[] = [];
  let totalLatency = 0;

  for (const operation of operations) {
    const opLatency = 500 + Math.random() * 2500;
    await sleep(opLatency);
    totalLatency += opLatency;

    if (Math.random() < 0.15) {
      const errors = [
        `Sharp: unsupported image format at ${sourceUrl}`,
        `ImageMagick: out of memory processing ${operation.type} operation`,
        `VIPS: corrupt JPEG header — cannot decode source`,
        `Codec error: ${operation.type} failed with exit code 137 (OOM killed)`,
      ];
      throw new Error(errors[Math.floor(Math.random() * errors.length)]);
    }

    switch (operation.type) {
      case 'resize':
        operationsApplied.push(`resize:${operation.width}x${operation.height}`);
        break;
      case 'compress':
        operationsApplied.push(`compress:q${operation.quality}`);
        break;
      case 'convert':
        operationsApplied.push(`convert:${operation.format}`);
        break;
    }
  }

  // Abordagem robusta e compatível em vez de usar findLast
  let ext = 'jpg';
  for (let i = operations.length - 1; i >= 0; i--) {
    if (operations[i].type === 'convert') {
      const op = operations[i] as { type: 'convert'; format: string };
      ext = op.format;
      break;
    }
  }

  const outputKey = `processed/${crypto.randomUUID()}.${ext}`;
  const originalSizeKb = Math.round(800 + Math.random() * 3200);
  
  const compressOp = operations.find((op) => op.type === 'compress') as
    | { type: 'compress'; quality: number }
    | undefined;
  
  const compressionRatio = compressOp ? compressOp.quality / 100 : 0.85;
  const processedSizeKb = Math.round(originalSizeKb * compressionRatio);

  const result: ImageProcessorResult = {
    outputUrl: `https://${outputBucket}.s3.amazonaws.com/${outputKey}`,
    originalSizeKb,
    processedSizeKb,
    compressionRatio,
    operationsApplied,
    processingBackend: 'sharp@0.33.4',
  };

  logger.info(
    {
      jobExecutionId,
      outputUrl: result.outputUrl,
      compressionRatio,
      totalLatencyMs: Math.round(totalLatency),
    },
    'Imagem processada com sucesso'
  );

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}