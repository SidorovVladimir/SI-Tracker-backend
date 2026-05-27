import { z } from 'zod';

export const CreateVerificationOrganizationInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export type CreateVerificationOrganizationInput = z.infer<
  typeof CreateVerificationOrganizationInputSchema
>;
