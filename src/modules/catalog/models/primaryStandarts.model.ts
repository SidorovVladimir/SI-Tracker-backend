import {
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';
import { relations } from 'drizzle-orm';

// Государственный первичный эталон (ГПЭ)
export const primaryStandarts = pgTable('primary_standards', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Таблица связи ManyToMany ГПЭ и приборов.
export const primaryStandartsToDevices = pgTable(
  'primary_standards_to_devices',
  {
    primaryStandartId: uuid('primary_standarts_id')
      .notNull()
      .references(() => primaryStandarts.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.primaryStandartId, t.deviceId] })]
);

export const primaryStandartsRelations = relations(
  primaryStandarts,
  ({ many }) => ({
    scopesToDevices: many(primaryStandartsToDevices),
  })
);

export const primaryStandartsToDevicesRelations = relations(
  primaryStandartsToDevices,
  ({ one }) => ({
    primaryStandart: one(primaryStandarts, {
      fields: [primaryStandartsToDevices.primaryStandartId],
      references: [primaryStandarts.id],
    }),

    device: one(devices, {
      fields: [primaryStandartsToDevices.deviceId],
      references: [devices.id],
    }),
  })
);
