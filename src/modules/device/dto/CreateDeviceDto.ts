import { z } from 'zod';

export const CreateDeviceInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  model: z.string().min(1, 'Model is required').max(50),
  serialNumber: z.string(),
  releaseDate: z.string().nullable(),
  grsiNumber: z.string().nullable(),
  measurementRange: z.string().nullable(),
  accuracy: z.string().nullable(),
  inventoryNumber: z.string().min(1, 'Inventory number is required').max(100),
  receiptDate: z.string().nullable(),
  manufacturer: z.string().nullable(),
  verificationInterval: z.number().int().nullable(),
  archived: z.boolean(),
  nomenclature: z.string().nullable(),
  statusId: z.uuid(),
  productionSiteId: z.uuid(),
  equipmentTypeId: z.uuid(),
  measurementTypeId: z.uuid(),
  scopes: z.array(z.uuid()),
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceInputSchema>;
