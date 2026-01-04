import { z } from 'zod';
import { CreateCityInputSchema } from './CreateCityDto';

export const UpdateCityInputSchema = CreateCityInputSchema;

export type UpdateCityInput = z.infer<typeof UpdateCityInputSchema>;
