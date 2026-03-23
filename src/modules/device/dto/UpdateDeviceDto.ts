import { z } from 'zod';

import { CreateDeviceInputSchema } from './CreateDeviceDto';

export const UpdateDeviceInputSchema = CreateDeviceInputSchema;

export type UpdateDeviceInput = z.infer<typeof UpdateDeviceInputSchema>;
