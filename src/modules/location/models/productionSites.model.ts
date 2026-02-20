import {
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { companies } from './company.model';
import { cities } from './city.model';
import { relations } from 'drizzle-orm';
import { devices } from '../../device/models/device.model';

// Производственная площадка (Участок)
export const productionSites = pgTable(
  'production_sites',
  {
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
  },
  (t) => [
    uniqueIndex('idx_site_unique_constraint').on(t.name, t.companyId, t.cityId),
  ]
);

export const productionSitesRelations = relations(
  productionSites,
  ({ one, many }) => ({
    city: one(cities, {
      fields: [productionSites.cityId],
      references: [cities.id],
    }),

    company: one(companies, {
      fields: [productionSites.companyId],
      references: [companies.id],
    }),

    devices: many(devices),
  })
);
