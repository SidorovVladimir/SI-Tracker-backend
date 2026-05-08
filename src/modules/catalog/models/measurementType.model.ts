import { relations } from 'drizzle-orm';
import {
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';

// Вид измерения (Электрические, радиоэлектронные, теплотехнические, геометрические, механические, физико-химические, виброакустические, микроклимат)
export const measurementTypes = pgTable('measurement_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const measurementTypesToDevices = pgTable(
  'measurement_types_to_devices',
  {
    measurementTypeId: uuid('measurement_types_id')
      .notNull()
      .references(() => measurementTypes.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.measurementTypeId, t.deviceId] })]
);

export const measurementTypesRelations = relations(
  measurementTypes,
  ({ many }) => ({
    measurementTypesToDevices: many(measurementTypesToDevices),
  })
);

export const measurementTypesToDevicesRelations = relations(
  measurementTypesToDevices,
  ({ one }) => ({
    measurementType: one(measurementTypes, {
      fields: [measurementTypesToDevices.measurementTypeId],
      references: [measurementTypes.id],
    }),

    device: one(devices, {
      fields: [measurementTypesToDevices.deviceId],
      references: [devices.id],
    }),
  })
);
