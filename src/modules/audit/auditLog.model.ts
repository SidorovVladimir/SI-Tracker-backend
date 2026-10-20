import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from '../user/user.model';

export const deviceAuditLogs = pgTable(
  'device_audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    deviceId: uuid('device_id'),

    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    action: text('action', {
      enum: [
        'create',
        'update',
        'delete',
        'create_batch',
        'assign_batch',
        'remove_batch',
        'assign_repair_batch',
        'verify',
        'repair_batch_create',
        'repair_batch_add_device',
        'repair_batch_remove_dev',
        'repair_batch_close',
        'device_scrap',
        'inspection_batch_create',
        'inspection_doc_save',
      ],
    }).notNull(),

    description: text('description').notNull(),

    newData: jsonb('new_data'),

    oldData: jsonb('old_data'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    deviceIdIdx: index('idx_audit_logs_device_id').on(table.deviceId),
    userIdIdx: index('idx_audit_logs_user_id').on(table.userId),
    actionIdx: index('idx_audit_logs_action').on(table.action),
    createdAtIdx: index('idx_audit_logs_created_at_desc').on(table.createdAt),
  })
);
