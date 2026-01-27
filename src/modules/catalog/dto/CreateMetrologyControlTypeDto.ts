import { z } from 'zod';

export const CreateMetrologyControlTypeInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export type CreateMetrologyControlTypeInput = z.infer<
  typeof CreateMetrologyControlTypeInputSchema
>;
