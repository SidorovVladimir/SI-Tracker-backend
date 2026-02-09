import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { statuses } from '../../catalog/models/status.model';
import { productionSites } from '../../location/models/productionSites.model';
import { equipmentTypes } from '../../catalog/models/equipmentType.model';
import { measurementTypes } from '../../catalog/models/measurementType.model';

// Прибор (Инструмент)
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).notNull(), // Наименование прибора
  model: varchar('model', { length: 50 }).notNull(), // Модель прибора
  serialNumber: varchar('serial_number', { length: 100 }).notNull(), // Серийный номер прибора
  releaseDate: timestamp('release_date'), // Дата выпуска
  grsiNumber: varchar('grsi_number', { length: 100 }), // ГРСИ
  measurementRange: varchar('measurement_range', { length: 100 }), // Диапазон измерений
  accuracy: varchar('accuracy', { length: 100 }), // Точность
  inventoryNumber: varchar('inventory_number', { length: 100 }).notNull(), // Инвентарный номер
  receiptDate: timestamp('receipt_date'), // Дата получения
  manufacturer: varchar('manufacturer', { length: 100 }), // Производитель
  verificationInterval: integer('verification_interval'), // МПИ (межповерочный интервал)
  archived: boolean('archived').notNull().default(false), // В архиве
  nomenclature: varchar('nomenclature', { length: 50 }), // Номенклатура по 1С
  createdAt: timestamp('created_at').defaultNow(),
  statusId: uuid('status_id')
    .notNull()
    .references(() => statuses.id),
  productionSiteId: uuid('production_site_id')
    .notNull()
    .references(() => productionSites.id),
  equipmentTypeId: uuid('equipment_type_id')
    .notNull()
    .references(() => equipmentTypes.id),
  measurementTypeId: uuid('measurement_type_id')
    .notNull()
    .references(() => measurementTypes.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
