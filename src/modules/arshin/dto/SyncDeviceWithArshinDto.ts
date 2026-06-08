import { z } from 'zod';

export const SyncDeviceWithArshinInputSchema = z.object({
  deviceId: z.uuid('Некорректный формат ID прибора'),
  batchId: z.uuid('Некорректный формат ID партии'),
});

export type SyncDeviceWithArshinInput = z.infer<
  typeof SyncDeviceWithArshinInputSchema
>;
