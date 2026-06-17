import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { statuses } from '../../catalog/models/status.model';
import { productionSites } from '../../location/models/productionSites.model';
import { equipmentTypes } from '../../catalog/models/equipmentType.model';
import { measurementTypesToDevices } from '../../catalog/models/measurementType.model';
import { scopesToDevices } from '../../catalog/models/scope.model';
import { verifications } from './verification.model';
import { primaryStandartsToDevices } from '../../catalog/models/primaryStandarts.model';
import { verificationOrganizations } from '../../catalog/models/verificationOrganization.model';

// Прибор (Инструмент)
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name').notNull(), // Наименование прибора
  model: varchar('model').notNull(), // Модель прибора
  serialNumber: varchar('serial_number').notNull(), // Серийный номер прибора
  releaseDate: timestamp('release_date'), // Дата выпуска
  grsiNumber: varchar('grsi_number', { length: 100 }), // ГРСИ
  measurementRange: varchar('measurement_range'), // Диапазон измерений
  accuracy: varchar('accuracy'), // Точность
  inventoryNumber: varchar('inventory_number', { length: 100 }), // Инвентарный номер
  receiptDate: timestamp('receipt_date'), // Дата получения
  manufacturer: varchar('manufacturer'), // Производитель
  verificationInterval: integer('verification_interval'), // МПИ (межповерочный интервал)
  archived: boolean('archived').notNull().default(false), // В архиве
  nomenclature: varchar('nomenclature'), // Номенклатура по 1С
  comment: text('comment'),
  leadTimeDays: integer('lead_time_days'),

  statusId: uuid('status_id')
    .notNull()
    .references(() => statuses.id),
  productionSiteId: uuid('production_site_id')
    .notNull()
    .references(() => productionSites.id),
  equipmentTypeId: uuid('equipment_type_id').references(
    () => equipmentTypes.id
  ),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verificationBatches = pgTable('verification_batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: varchar('number', { length: 100 }).notNull(), // Номер заявки
  plannedDate: timestamp('planned_date').notNull(), // Планируемый месяц/дата отправки
  verificationOrganizationId: uuid('verification_organization_id').references(
    () => verificationOrganizations.id
  ), // Куда везем (ссылка на вашу таблицу)
  status: text('status').notNull().default('draft'), // 'draft' | 'sent' | 'completed'
  comment: text('comment'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 3. Промежуточная таблица связей приборов и партий
export const devicesToBatches = pgTable(
  'devices_to_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => verificationBatches.id, { onDelete: 'cascade' }),
    deviceStatus: text('device_status').notNull().default('selected'), // 'selected' | 'dismantled' | 'returned'
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceIdIdx: index('dtb_device_id_idx').on(table.deviceId),
    batchIdIdx: index('dtb_batch_id_idx').on(table.batchId),
  })
);

export const verificationBatchesRelations = relations(
  verificationBatches,
  ({ one, many }) => ({
    verificationOrganization: one(verificationOrganizations, {
      fields: [verificationBatches.verificationOrganizationId],
      references: [verificationOrganizations.id],
    }),
    devicesToBatches: many(devicesToBatches),
  })
);

export const devicesToBatchesRelations = relations(
  devicesToBatches,
  ({ one }) => ({
    device: one(devices, {
      fields: [devicesToBatches.deviceId],
      references: [devices.id],
    }),
    batch: one(verificationBatches, {
      fields: [devicesToBatches.batchId],
      references: [verificationBatches.id],
    }),
  })
);

export const devicesRelations = relations(devices, ({ one, many }) => ({
  status: one(statuses, {
    fields: [devices.statusId],
    references: [statuses.id],
  }),
  productionSite: one(productionSites, {
    fields: [devices.productionSiteId],
    references: [productionSites.id],
  }),
  equipmentType: one(equipmentTypes, {
    fields: [devices.equipmentTypeId],
    references: [equipmentTypes.id],
  }),
  verifications: many(verifications),
  scopesToDevices: many(scopesToDevices),
  primaryStandartsToDevices: many(primaryStandartsToDevices),
  measurementTypesToDevices: many(measurementTypesToDevices),
  devicesToBatches: many(devicesToBatches),
}));
