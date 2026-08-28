import { relations } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { devices } from '../../device/models/device.model';

// Состояния прибора (Годен, Не годен, Утерян, Списан, Забракован, длительное хранение)
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index('idx_statuses_name').on(table.name),
  })
);

export const statusesRelations = relations(statuses, ({ many }) => ({
  devices: many(devices),
}));
