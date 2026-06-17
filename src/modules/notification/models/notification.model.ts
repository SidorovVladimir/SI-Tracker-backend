import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from '../../user/user.model';

export const systemNotifications = pgTable(
  'system_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }), // null = для всех
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message').notNull(),
    type: varchar('type', { length: 50 }).notNull().default('info'),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    notifCreatedAtIdx: index('sn_created_at_idx').on(table.createdAt),
    notifUserIdx: index('sn_user_id_idx').on(table.userId), // Поможет быстро искать уведомления конкретного юзера
  })
);

export const userNotificationStatuses = pgTable(
  'user_notification_statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => systemNotifications.id, { onDelete: 'cascade' }),
    isRead: boolean('is_read').notNull().default(true), // Если запись тут есть, значит прочитано
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userNotifIdx: index('uns_user_notif_idx').on(
      table.userId,
      table.notificationId
    ),
    notifIdIdx: index('uns_notification_id_idx').on(table.notificationId),
  })
);

export const systemNotificationsRelations = relations(
  systemNotifications,
  ({ one, many }) => ({
    // Сохраняем вашу старую связь: кто создал/кому принадлежит уведомление
    user: one(users, {
      fields: [systemNotifications.userId],
      references: [users.id],
    }),
    // Добавляем связь: у одного уведомления может быть много статусов прочтения разными людьми
    statuses: many(userNotificationStatuses),
  })
);

// 2.НОВОЕ: Отношения для промежуточной таблицы статусов прочтения
export const userNotificationStatusesRelations = relations(
  userNotificationStatuses,
  ({ one }) => ({
    // Связь статуса с конкретным пользователем, который прочитал
    user: one(users, {
      fields: [userNotificationStatuses.userId],
      references: [users.id],
    }),
    // Связь статуса с самим прочитанным уведомлением
    notification: one(systemNotifications, {
      fields: [userNotificationStatuses.notificationId],
      references: [systemNotifications.id],
    }),
  })
);
