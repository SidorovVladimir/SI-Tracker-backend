import { relations } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';

// Тип оборудования (СИ, СК, ИО, ВО, Индикатор)
export const equipmentTypes = pgTable('equipment_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const equipmentTypesRelations = relations(
  equipmentTypes,
  ({ many }) => ({
    devices: many(devices),
  })
);
