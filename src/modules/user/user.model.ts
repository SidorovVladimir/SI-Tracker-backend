import { pgEnum, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user']);

// Пользователи
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firstName: varchar('first_name', { length: 50 }).notNull(),
  lastName: varchar('last_name', { length: 50 }).notNull(),
  email: varchar('email', { length: 50 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  role: roleEnum().notNull(),
});
