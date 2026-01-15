import { z } from 'zod';

export const CreateProductionSiteInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(50, 'Название должно быть не более 50 символов'),
  companyId: z.string().min(1, 'Company is required'),
  cityId: z.string().min(1, 'City is required'),
});

export type CreateProductionSiteInput = z.infer<
  typeof CreateProductionSiteInputSchema
>;
