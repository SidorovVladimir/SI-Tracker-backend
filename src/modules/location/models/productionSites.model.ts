import { pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { companies } from './company.model';
import { cities } from './city.model';

// Производственная площадка (Участок)
export const productionSites = pgTable('production_sites', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  cityId: uuid('city_id')
    .notNull()
    .references(() => cities.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
