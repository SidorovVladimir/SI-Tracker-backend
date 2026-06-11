import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from '../../user/user.model';

// Таблица текстовых сообщений чата
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Кто отправил сообщение
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Кто получатель сообщения
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Текст самого сообщения
    text: text('text').notNull(),

    // Статус прочтения (важно для вывода счетчика непрочитанных)
    isRead: boolean('is_read').notNull().default(false),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    // ИНДЕКСЫ ДЛЯ УСКОРЕНИЯ ВЫБОРКИ ИСТОРИИ ДИАЛОГОВ:
    // База будет мгновенно находить диалог между Метрологом А и Метрологом Б
    senderIdx: index('cm_sender_id_idx').on(table.senderId),
    recipientIdx: index('cm_recipient_id_idx').on(table.recipientId),
    // Индекс для быстрого поиска всех непрочитанных сообщений сотрудника
    unreadIdx: index('cm_unread_recipient_idx').on(
      table.recipientId,
      table.isRead
    ),
    createdAtIdx: index('cm_created_at_idx').on(table.createdAt),
  })
);

// Описание связей (Relations) для Drizzle
export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  sender: one(users, {
    fields: [chatMessages.senderId],
    references: [users.id],
    relationName: 'sent_messages',
  }),
  recipient: one(users, {
    fields: [chatMessages.recipientId],
    references: [users.id],
    relationName: 'received_messages',
  }),
}));
