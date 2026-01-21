import { z } from 'zod';
import { CreateProductionSiteInputSchema } from './CreateProductionSiteDto';

export const UpdateProductionSiteInputSchema = CreateProductionSiteInputSchema;

export type UpdateProductionSiteInput = z.infer<
  typeof UpdateProductionSiteInputSchema
>;
