import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { users } from '../user/user.model';

export const deviceAuditLogs = pgTable('device_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),

  deviceId: uuid('device_id').notNull(),

  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

  action: text('action', {
    enum: [
      'create',
      'update',
      'delete',
      'assign_batch',
      'remove_batch',
      'verify',
    ],
  }).notNull(),

  description: text('description').notNull(),

  newData: jsonb('new_data'),

  oldData: jsonb('old_data'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
