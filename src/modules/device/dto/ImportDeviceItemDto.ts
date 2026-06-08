import { z } from 'zod';

export const ImportDeviceItemSchema = z.object({
  name: z.string().min(1, 'Наименование прибора обязательно'),
  model: z.string().min(1, 'Модель обязательна'),
  serialNumber: z.string().min(1, 'Серийный номер обязателен'),
  grsiNumber: z.string().optional().nullable(),
  inventoryNumber: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  verificationInterval: z.string().optional().nullable(),
  nomenclature: z.string().optional().nullable(),
  comment: z.string().optional().nullable(),

  cityName: z.string().min(1, 'Город обязателен'),
  companyName: z.string().min(1, 'Компания обязательна'),
  productionSiteName: z.string().min(1, 'Площадка обязательна'),
  statusName: z.string().min(1, 'Статус обязателен'),
  equipmentTypeName: z.string().optional().nullable(),
  scopesNames: z.string().optional().nullable(),
  measurementTypesNames: z.string().optional().nullable(),
  primaryStandardsNames: z.string().optional().nullable(),
  measurementRange: z.string().optional().nullable(),
  accuracy: z.string().optional().nullable(),
});

export const ImportDevicesExcelInputSchema = z.array(ImportDeviceItemSchema);

export type ImportDeviceItem = z.infer<typeof ImportDeviceItemSchema>;
