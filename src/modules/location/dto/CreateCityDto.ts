import { z } from 'zod';

export const CreateCityInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(50, 'Название должно быть не более 50 символов'),
});

export type CreateCityInput = z.infer<typeof CreateCityInputSchema>;
