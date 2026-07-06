import z from 'zod';

export const CreatePrimaryStandartInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().nullable(),
});

export type CreatePrimaryStandartInput = z.infer<
  typeof CreatePrimaryStandartInputSchema
>;
