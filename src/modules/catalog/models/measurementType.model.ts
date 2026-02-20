import { relations } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';

// Вид измерения (Электрические, радиоэлектронные, теплотехнические, геометрические, механические, физико-химические, виброакустические, микроклимат)
export const measurementTypes = pgTable('measurement_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const measurementTypesRelations = relations(
  measurementTypes,
  ({ many }) => ({
    devices: many(devices),
  })
);
