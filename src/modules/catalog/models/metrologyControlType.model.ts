import { relations } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { verifications } from '../../device/models/verification.model';

// Виды метрологического контроля (Поверка, калибровка, аттестация, осмотр)
export const metrologyControleTypes = pgTable('metrology_controle_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const metrologyControlTypesRelations = relations(
  metrologyControleTypes,
  ({ many }) => ({
    verifications: many(verifications),
  })
);
