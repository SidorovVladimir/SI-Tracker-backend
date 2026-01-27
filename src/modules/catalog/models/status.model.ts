import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Состояния прибора (Годен, Не годен, Утерян, Списан, Забракован, длительное хранение)
export const statuses = pgTable('statuses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
