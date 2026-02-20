import {
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';
import { relations } from 'drizzle-orm';

// Сферы применения (ГРОЕИ и прочие) (ОТ, учет ресурсов, ПБ, сертификация продукции, аккредитация ИЛ, правовое поле, добровольно)
export const scopes = pgTable('scopes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Таблица связи ManyToMany Сфер применения и приборов.
export const scopesToDevices = pgTable(
  'scopes_to_devices',
  {
    scopeId: uuid('scope_id')
      .notNull()
      .references(() => scopes.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scopeId, t.deviceId] })]
);

export const scopesRelations = relations(scopes, ({ many }) => ({
  scopesToDevices: many(scopesToDevices),
}));

export const scopesToDevicesRelations = relations(
  scopesToDevices,
  ({ one }) => ({
    scope: one(scopes, {
      fields: [scopesToDevices.scopeId],
      references: [scopes.id],
    }),

    device: one(devices, {
      fields: [scopesToDevices.deviceId],
      references: [devices.id],
    }),
  })
);
