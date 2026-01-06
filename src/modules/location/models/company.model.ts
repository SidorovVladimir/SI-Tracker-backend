import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Компания (ООО Рога и Копыта)
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  address: text('address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
