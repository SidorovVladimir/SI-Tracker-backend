import z from 'zod';

export const CreatePrimaryStandartInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export type CreatePrimaryStandartInput = z.infer<
  typeof CreatePrimaryStandartInputSchema
>;
