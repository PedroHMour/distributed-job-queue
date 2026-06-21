// Espelha os enums do Prisma para uso em runtime sem importar o @prisma/client em todos os lugares
export const JOB_TYPES = {
  EMAIL_DELIVERY: 'EMAIL_DELIVERY',
  IMAGE_PROCESSING: 'IMAGE_PROCESSING',
  REPORT_GENERATION: 'REPORT_GENERATION',
} as const;

export type JobType = keyof typeof JOB_TYPES;

export const JOB_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  DEAD: 'DEAD',
} as const;

export type JobStatus = keyof typeof JOB_STATUS;

// Payloads tipados por job type — o contrato entre API e Worker
export interface EmailDeliveryPayload {
  to: string;
  subject: string;
  templateId: string;
  variables: Record<string, string>;
}

export interface ImageProcessingPayload {
  sourceUrl: string;
  operations: Array<
    | { type: 'resize'; width: number; height: number }
    | { type: 'compress'; quality: number }
    | { type: 'convert'; format: 'webp' | 'png' | 'jpeg' }
  >;
  outputBucket: string;
}

export interface ReportGenerationPayload {
  reportType: 'sales' | 'inventory' | 'user_activity';
  dateRange: { from: string; to: string }; // ISO 8601
  filters: Record<string, unknown>;
  outputFormat: 'pdf' | 'csv' | 'xlsx';
  recipientEmail: string;
}

// Union discriminada — usada nos workers para type-safe switching
export type JobPayload =
  | { type: 'EMAIL_DELIVERY'; data: EmailDeliveryPayload }
  | { type: 'IMAGE_PROCESSING'; data: ImageProcessingPayload }
  | { type: 'REPORT_GENERATION'; data: ReportGenerationPayload };