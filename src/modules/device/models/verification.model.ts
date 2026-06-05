import {
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices, verificationBatches } from './device.model';
import { relations } from 'drizzle-orm';
import { verificationOrganizations } from '../../catalog/models/verificationOrganization.model';

// Данные о поверках
export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: timestamp('date'), // Дата проведения
    validUntil: timestamp('valid_until'), // Дата окончания срока действия
    result: text('result'), // Результат
    protocolNumber: varchar('protocol_number', { length: 50 }), // Номер протокола/свидетельства
    organization: varchar('organization', { length: 255 }), // Организация проводившая поверку
    comment: text('comment'), // Примечание
    documentUrl: text('document_url'), // Ссылка на документ поверки
    metrologyControleTypeId: uuid('metrology_controle_type_id').references(
      () => metrologyControleTypes.id
    ),
    verificationOrganizationId: uuid('verification_organization_id').references(
      () => verificationOrganizations.id
    ),
    batchId: uuid('batch_id').references(() => verificationBatches.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    cost: numeric('cost', { precision: 10, scale: 2 }).default('0.00'),

    //   deviceId: uuid('device_id')
    // .notNull()
    // .references(() => devices.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    deviceIdIdx: index('verifications_device_id_idx').on(table.deviceId),
    batchIdIdx: index('verifications_batch_id_idx').on(table.batchId),
    dateIdx: index('verifications_date_idx').on(table.date),
  })
);

export const verificationsRelations = relations(verifications, ({ one }) => ({
  device: one(devices, {
    fields: [verifications.deviceId],
    references: [devices.id],
  }),
  metrologyControleType: one(metrologyControleTypes, {
    fields: [verifications.metrologyControleTypeId],
    references: [metrologyControleTypes.id],
  }),
  verificationOrganization: one(verificationOrganizations, {
    fields: [verifications.verificationOrganizationId],
    references: [verificationOrganizations.id],
  }),
  batch: one(verificationBatches, {
    fields: [verifications.batchId],
    references: [verificationBatches.id],
  }),
}));
