import { z } from 'zod';

export const CreateVerificationInputSchema = z.object({
  date: z.coerce.date().nullable(),
  validUntil: z.coerce.date().nullable(),
  result: z.string().nullable(),
  protocolNumber: z.string().nullable(),
  organization: z.string().nullable(),
  comment: z.string().nullable(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid().nullable(),
  deviceId: z.uuid(),
  cost: z.coerce
    .number('Стоимость должна быть числом')
    .min(0, 'Стоимость не может быть отрицательной')
    .default(0)
    .optional(),
});

export type CreateVerificationInput = z.infer<
  typeof CreateVerificationInputSchema
>;

export const CreateVerificationModalInputSchema = z.object({
  deviceId: z.uuid('Невалидный ID устройства'),
  batchId: z.uuid().nullable().optional(),
  protocolNumber: z.string().min(1, 'Номер свидетельства обязателен'),
  result: z.string().min(1, 'Результат обязателен'),

  // Коэрция (преобразование) строк в объекты Date
  date: z.coerce.date({ message: 'Неверный формат даты проведения' }),

  // Дата окончания может быть null, если результат "Не годен"
  validUntil: z.coerce.date().nullable().optional(),
  documentUrl: z.string().nullable(),
  metrologyControleTypeId: z.uuid('Невалидный ID типа контроля'),
  verificationOrganizationId: z.uuid('Невалидный ID организации'),
  comment: z.string().nullable().optional(),
  cost: z.coerce
    .number('Стоимость должна быть числом')
    .min(0, 'Стоимость не может быть отрицательной')
    .default(0)
    .optional(),
});

export const FetchArshinVerificationsInputSchema = z.object({
  grsiNumber: z.string().default(''),
  serialNumber: z.string().min(1, 'Заводской номер обязателен для поиска'),
  count: z.number().int().min(1).max(10).default(3),
});

// Типизация на основе Zod-схемы для сервиса
export type CreateVerificationDto = z.infer<
  typeof CreateVerificationModalInputSchema
>;
