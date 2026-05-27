import { relations } from 'drizzle-orm';
import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { verifications } from '../../device/models/verification.model';

// Организации поверители

export const verificationOrganizations = pgTable('verification_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verificationOrganizationsRelations = relations(
  verificationOrganizations,
  ({ many }) => ({
    verifications: many(verifications),
  })
);
