import { z } from 'zod';

export const CreateVerificationBatchSchema = z.object({
  number: z.string().min(1, 'Номер партии обязателен'),
  plannedDate: z.coerce
    .date({ message: 'Неверный формат даты ISO' })
    .transform((val) => new Date(val)),
  verificationOrganizationId: z.uuid().nullable().optional(),
  comment: z.string().nullable().optional(),
});
