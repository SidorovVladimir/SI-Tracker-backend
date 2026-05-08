import { z } from 'zod';

const VerificationInput = z.object({
  date: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  result: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  organization: z.string().nullable(),
  comment: z.string().nullable(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid().nullable(),
});
export const CreateDeviceInputSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  model: z.string().min(1, 'Model is required'),
  serialNumber: z.string(),
  releaseDate: z.coerce.date().nullable(),
  grsiNumber: z.string().nullable(),
  measurementRange: z.string().nullable(),
  accuracy: z.string().nullable(),
  inventoryNumber: z.string().nullable(),
  receiptDate: z.coerce.date().nullable(),
  manufacturer: z.string().nullable(),
  verificationInterval: z.number().int().nullable(),
  archived: z.boolean(),
  nomenclature: z.string().nullable(),
  comment: z.string().nullable(),
  statusId: z.uuid(),
  productionSiteId: z.uuid(),
  equipmentTypeId: z.uuid().nullable(),
  scopes: z.array(z.uuid()).nullable(),
  primaryStandarts: z.array(z.uuid()).nullable(),
  measurementTypes: z.array(z.uuid()).nullable(),
  verifications: z.array(VerificationInput),
});

export type CreateDeviceInput = z.infer<typeof CreateDeviceInputSchema>;
