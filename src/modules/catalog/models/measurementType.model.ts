import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Вид измерения (Электрические, радиоэлектронные, теплотехнические, геометрические, механические, физико-химические, виброакустические, микроклимат)
export const measurementTypes = pgTable('measurement_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
