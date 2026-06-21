import { z } from 'zod';

const EmailDeliverySchema = z.object({
  type: z.literal('EMAIL_DELIVERY'),
  priority: z.number().int().min(0).max(10).default(0),
  data: z.object({
    to: z.string().email({ message: 'Endereço de e-mail inválido' }),
    subject: z.string().min(1).max(255),
    templateId: z.string().min(1),
    variables: z.record(z.string()).default({}),
  }),
});

const ImageProcessingSchema = z.object({
  type: z.literal('IMAGE_PROCESSING'),
  priority: z.number().int().min(0).max(10).default(0),
  data: z.object({
    sourceUrl: z.string().url({ message: 'URL da imagem inválida' }),
    operations: z
      .array(
        z.discriminatedUnion('type', [
          z.object({
            type: z.literal('resize'),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          }),
          z.object({
            type: z.literal('compress'),
            quality: z.number().int().min(1).max(100),
          }),
          z.object({
            type: z.literal('convert'),
            format: z.enum(['webp', 'png', 'jpeg']),
          }),
        ])
      )
      .min(1, { message: 'Pelo menos uma operação é obrigatória' }),
    outputBucket: z.string().min(1),
  }),
});

const ReportGenerationSchema = z.object({
  type: z.literal('REPORT_GENERATION'),
  priority: z.number().int().min(0).max(10).default(0),
  data: z.object({
    reportType: z.enum(['sales', 'inventory', 'user_activity']),
    dateRange: z.object({
      from: z.string().datetime({ message: 'Data ISO 8601 obrigatória' }),
      to: z.string().datetime({ message: 'Data ISO 8601 obrigatória' }),
    }),
    filters: z.record(z.unknown()).default({}),
    outputFormat: z.enum(['pdf', 'csv', 'xlsx']),
    recipientEmail: z.string().email(),
  }),
});

// Union discriminada — o campo `type` determina qual schema validar
export const CreateJobSchema = z.discriminatedUnion('type', [
  EmailDeliverySchema,
  ImageProcessingSchema,
  ReportGenerationSchema,
]);

export type CreateJobInput = z.infer<typeof CreateJobSchema>;