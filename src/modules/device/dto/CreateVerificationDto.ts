import { z } from 'zod';

export const CreateVerificationInputSchema = z.object({
  date: z.string(),
  validUntil: z.string(),
  result: z.string().nullable(),
  protocolNumber: z.string(),
  organization: z.string().nullable(),
  comment: z.string().nullable(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid(),
  deviceId: z.uuid(),
});

export type CreateVerificationInput = z.infer<
  typeof CreateVerificationInputSchema
>;
