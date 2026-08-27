import {
  boolean,
  index,
  integer,
  pgEnum,
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

import { primaryStandartsToDevices } from '../../catalog/models/primaryStandarts.model';
import { users } from '../../user/user.model';
import {
  verifications,
  arshinVerificationBuffer,
  devicesToBatches,
} from '../../verification/models/verification.model';

// Прибор (Инструмент)
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name').notNull(), // Наименование прибора
  model: varchar('model').notNull(), // Модель прибора
  serialNumber: varchar('serial_number').notNull(), // Серийный номер прибора
  releaseDate: timestamp('release_date'), // Дата выпуска
  grsiNumber: varchar('grsi_number', { length: 100 }), // ГРСИ
  csmCode: varchar('csm_code', { length: 100 }), // Код СИ из прайса ЦСМ (договорной)
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
  createdById: uuid('created_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),

  updatedById: uuid('updated_by_id').references(() => users.id, {
    onDelete: 'set null',
  }),
});

export const deviceDocumentTypeEnum = pgEnum('device_document_type', [
  'manual', // Руководство по эксплуатации (РЭ)
  'passport', // Паспорт / Формуляр / Акты
]);

export const deviceDocuments = pgTable(
  'device_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name').notNull(), // Например, "РЭ Нутромер НИ-160", "Паспорт зав. № 102213316"
    fileUrl: text('file_url').notNull(), // Ссылка на S3 / MinIO / хранилище
    fileSize: integer('file_size'), // Размер файла в байтах
    mimeType: varchar('mime_type', { length: 100 }), // application/pdf
    type: deviceDocumentTypeEnum('type').notNull(),

    // 1. Для Паспортов: жесткая привязка к конкретному серийнику
    deviceId: uuid('device_id').references(() => devices.id, {
      onDelete: 'cascade',
    }),

    // 2. Для Руководств (РЭ): комбинированная привязка, чтобы разделять модификации внутри ГРСИ
    grsiNumber: varchar('grsi_number', { length: 100 }), // Заполняется для СИ
    modelName: varchar('model_name'), // Модель (заполняется для всех: СИ, ВО, ИО)

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    deviceIdIdx: index('doc_device_id_idx').on(table.deviceId),
    // Составной индекс для мгновенного поиска руководств по ГРСИ и Модели вместе
    grsiModelIdx: index('doc_grsi_model_idx').on(
      table.grsiNumber,
      table.modelName
    ),
  })
);

export const deviceDocumentsRelations = relations(
  deviceDocuments,
  ({ one }) => ({
    device: one(devices, {
      fields: [deviceDocuments.deviceId],
      references: [devices.id],
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
  arshinBuffers: many(arshinVerificationBuffer),
  scopesToDevices: many(scopesToDevices),
  primaryStandartsToDevices: many(primaryStandartsToDevices),
  measurementTypesToDevices: many(measurementTypesToDevices),
  devicesToBatches: many(devicesToBatches),
  documents: many(deviceDocuments),
  createdBy: one(users, {
    fields: [devices.createdById],
    references: [users.id],
  }),
  updatedBy: one(users, {
    fields: [devices.updatedById],
    references: [users.id],
  }),
}));
