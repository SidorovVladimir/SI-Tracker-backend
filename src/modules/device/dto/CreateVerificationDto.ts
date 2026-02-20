import { z } from 'zod';

export const CreateVerificationInputSchema = z.object({
  date: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  result: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  organization: z.string().nullable(),
  comment: z.string().nullable(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid(),
  deviceId: z.uuid(),
});

export type CreateVerificationInput = z.infer<
  typeof CreateVerificationInputSchema
>;
