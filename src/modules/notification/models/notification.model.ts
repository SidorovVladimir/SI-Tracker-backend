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

    // Кому предназначено уведомление. Если NULL — видят ВСЕ пользователи (глобальное)
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),

    title: varchar('title', { length: 255 }).notNull(), // Заголовок (напр. "Бэкап базы данных")
    message: text('message').notNull(), // Текст (напр. "Резервная копия успешно сгенерирована")

    // Тип для иконок: 'info' | 'success' | 'warning' | 'error'
    type: varchar('type', { length: 50 }).notNull().default('info'),

    isRead: boolean('is_read').notNull().default(false),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('sn_user_id_idx').on(table.userId),
    userReadIdx: index('sn_user_read_idx').on(table.userId, table.isRead),
  })
);

export const systemNotificationsRelations = relations(
  systemNotifications,
  ({ one }) => ({
    user: one(users, {
      fields: [systemNotifications.userId],
      references: [users.id],
    }),
  })
);
