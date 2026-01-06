import { z } from 'zod';
import { CreateCompanyInputSchema } from './CreateCompanyDto';

export const UpdateCompanyInputSchema = CreateCompanyInputSchema;

export type UpdateCompanyInput = z.infer<typeof UpdateCompanyInputSchema>;
