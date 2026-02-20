import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices } from './device.model';

// Данные о поверках
export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: timestamp('date'), // Дата проведения
  validUntil: timestamp('valid_until'), // Дата окончания срока действия
  result: text('result'), // Результат
  protocolNumber: varchar('protocol_number', { length: 50 }), // Номер протокола/свидетельства
  organization: varchar('organization', { length: 255 }), // Организация проводившая поверку
  comment: text('comment'), // Примечание
  documentUrl: text('document_url'), // Ссылка на документ поверки
  metrologyControleTypeId: uuid('metrology_controle_type_id')
    .notNull()
    .references(() => metrologyControleTypes.id),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
