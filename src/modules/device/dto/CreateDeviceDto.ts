import { z } from 'zod';

const VerificationInput = z.object({
  date: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  result: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  organization: z.string().nullable(),
  comment: z.string().nullable(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid(),
});
export const CreateDeviceInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  model: z.string().min(1, 'Model is required').max(50),
  serialNumber: z.string(),
  releaseDate: z.coerce.date().nullable(),
  grsiNumber: z.string().nullable(),
  measurementRange: z.string().nullable(),
  accuracy: z.string().nullable(),
  inventoryNumber: z.string().min(1, 'Inventory number is required').max(100),
  receiptDate: z.coerce.date().nullable(),
  manufacturer: z.string().nullable(),
  verificationInterval: z.number().int().nullable(),
  archived: z.boolean(),
  nomenclature: z.string().nullable(),
  statusId: z.uuid(),
  productionSiteId: z.uuid(),
  equipmentTypeId: z.uuid(),
  measurementTypeId: z.uuid(),
  scopes: z.array(z.uuid()),
  verifications: z.array(VerificationInput),
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceInputSchema>;
