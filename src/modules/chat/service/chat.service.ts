import { and, eq, or, desc, sql, ne, notInArray, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { chatMessages } from '../models/message.model';
import { users } from '../../user/user.model';

export class ChatService {
  constructor(private db: DrizzleDB) {}

  // 1. Получить историю переписки
  // async getChatHistory(
  //   currentUserId: string,
  //   recipientId: string,
  //   limit: number,
  //   offset: number
  // ) {
  //   return await this.db
  //     .select()
  //     .from(chatMessages)
  //     .where(
  //       or(
  //         and(
  //           eq(chatMessages.senderId, currentUserId),
  //           eq(chatMessages.recipientId, recipientId)
  //         ),
  //         and(
  //           eq(chatMessages.senderId, recipientId),
  //           eq(chatMessages.recipientId, currentUserId)
  //         )
  //       )
  //     )
  //     .orderBy(desc(chatMessages.createdAt))
  //     .limit(limit)
  //     .offset(offset);
  // }
  async getChatHistory(
    currentUserId: string,
    recipientId: string,
    limit: number,
    offset: number
  ) {
    // 1. Сначала вырезаем из базы последние 50 сообщений (desc)
    const subquery = this.db
      .select()
      .from(chatMessages)
      .where(
        or(
          and(
            eq(chatMessages.senderId, currentUserId),
            eq(chatMessages.recipientId, recipientId)
          ),
          and(
            eq(chatMessages.senderId, recipientId),
            eq(chatMessages.recipientId, currentUserId)
          )
        )
      )
      .orderBy(desc(chatMessages.createdAt)) // Берем самые свежие
      .limit(limit)
      .offset(offset)
      .as('subquery');

    // 2. 🔥 ИСПРАВЛЕНО: Разворачиваем этот срез данных на уровне самой базы по возрастанию (asc)!
    // Теперь сервер всегда будет отдавать массив в хронологическом порядке [1, 2, 3 ... 10]
    return await this.db
      .select()
      .from(subquery)
      .orderBy(asc(subquery.createdAt));
  }

  // async getChatUsers(currentUserId: string) {
  //   return await this.db
  //     .select({
  //       id: users.id,
  //       firstName: users.firstName,
  //       lastName: users.lastName,
  //       email: users.email,
  //       role: users.role,
  //     })
  //     .from(users)
  //     .where(ne(users.id, currentUserId)); // Исключаем себя из списка контактов
  // }

  // 2. Получить агрегированный список диалогов
  // async getChatDialogs(currentUserId: string) {
  //   const result = await this.db.execute(sql`
  //     WITH last_messages AS (
  //       SELECT DISTINCT ON (
  //         CASE WHEN sender_id = ${currentUserId} THEN recipient_id ELSE sender_id END
  //       )
  //       id, text, created_at, sender_id, recipient_id
  //       FROM chat_messages
  //       WHERE sender_id = ${currentUserId} OR recipient_id = ${currentUserId}
  //       ORDER BY CASE WHEN sender_id = ${currentUserId} THEN recipient_id ELSE sender_id END, created_at DESC
  //     ),
  //     unread_counts AS (
  //       SELECT sender_id, COUNT(*) as unread_count
  //       FROM chat_messages
  //       WHERE recipient_id = ${currentUserId} AND is_read = false
  //       GROUP BY sender_id
  //     )
  //     SELECT
  //       u.id as "companionId",
  //       u.first_name || ' ' || u.last_name as "companionName",
  //       lm.text as "lastMessageText",
  //       lm.created_at as "lastMessageCreatedAt",
  //       COALESCE(uc.unread_count, 0)::int as "unreadCount"
  //     FROM last_messages lm
  //     JOIN users u ON u.id = CASE WHEN lm.sender_id = ${currentUserId} THEN lm.recipient_id ELSE lm.sender_id END
  //     LEFT JOIN unread_counts uc ON uc.sender_id = u.id
  //     ORDER BY lm.created_at DESC
  //   `);
  //   return result.rows;
  // }

  async getChatUsers(currentUserId: string) {
    const cleanUserId = currentUserId.toLowerCase().trim();

    // 1. Находим ID всех пользователей, с кем у нас ЕСТЬ сообщения в базе
    const activeDialogs = await this.db
      .select({
        companionId: sql<string>`CASE WHEN sender_id = ${cleanUserId} THEN recipient_id ELSE sender_id END`,
      })
      .from(chatMessages)
      .where(
        or(
          eq(chatMessages.senderId, cleanUserId),
          eq(chatMessages.recipientId, cleanUserId)
        )
      );

    // Собираем массив UUID собеседников
    const excludedIds = activeDialogs.map((d) => d.companionId.toLowerCase());

    // 2. Делаем основной запрос к таблице пользователей
    let queryCondition = ne(users.id, currentUserId); // Исключаем себя

    // Если у нас уже есть активные диалоги, исключаем и их тоже
    if (excludedIds.length > 0) {
      queryCondition = and(
        queryCondition,
        notInArray(users.id, excludedIds) // ИСКЛЮЧАЕМ ТЕХ, С КЕМ УЖЕ ЕСТЬ ЧАТ
      ) as any;
    }

    return await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(queryCondition);
  }

  async getChatDialogs(currentUserId: string) {
    const cleanUserId = currentUserId.toLowerCase().trim();

    // 1. Вытаскиваем вообще все сообщения, где участвовал текущий пользователь
    const allUserMessages = await this.db
      .select()
      .from(chatMessages)
      .where(
        or(
          sql`lower(cast(${chatMessages.senderId} as text)) = ${cleanUserId}`,
          sql`lower(cast(${chatMessages.recipientId} as text)) = ${cleanUserId}`
        )
      )
      .orderBy(desc(chatMessages.createdAt));

    // 2. Группируем их в JavaScript (это на 100% избавит от ошибок типизации базы)
    const dialogsMap = new Map<string, any>();

    for (const msg of allUserMessages) {
      // Определяем, кто в этом сообщении наш собеседник (коллега)
      const companionId =
        msg.senderId.toLowerCase() === cleanUserId
          ? msg.recipientId
          : msg.senderId;

      const companionKey = companionId.toLowerCase();

      // Если мы уже сохранили более свежее сообщение для этого собеседника — пропускаем старое
      if (dialogsMap.has(companionKey)) {
        // Но если это сообщение было отправлено НАМ и оно непрочитано — увеличиваем счетчик
        if (msg.recipientId.toLowerCase() === cleanUserId && !msg.isRead) {
          dialogsMap.get(companionKey).unreadCount += 1;
        }
        continue;
      }

      // Ищем имя собеседника в таблице пользователей
      const companionUser = await this.db.query.users.findFirst({
        where: (users, { eq }) => eq(users.id, companionId),
      });

      if (!companionUser) continue;

      dialogsMap.set(companionKey, {
        companionId: companionUser.id,
        companionName: `${companionUser.firstName} ${companionUser.lastName}`,
        lastMessageText: msg.text,
        lastMessageCreatedAt: msg.createdAt.toISOString(),
        unreadCount:
          msg.recipientId.toLowerCase() === cleanUserId && !msg.isRead ? 1 : 0,
      });
    }

    // Возвращаем массив диалогов, отсортированный по дате последнего сообщения
    return Array.from(dialogsMap.values()).sort(
      (a, b) =>
        new Date(b.lastMessageCreatedAt).getTime() -
        new Date(a.lastMessageCreatedAt).getTime()
    );
  }

  // 3. Получить общий счетчик непрочитанных сообщений
  async getTotalUnreadCount(currentUserId: string): Promise<number> {
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.recipientId, currentUserId),
          eq(chatMessages.isRead, false)
        )
      );
    return countResult?.count ?? 0;
  }

  // 4. Отметить сообщения прочитанными
  // async markAsRead(currentUserId: string, senderId: string): Promise<boolean> {
  //   await this.db
  //     .update(chatMessages)
  //     .set({ isRead: true })
  //     .where(
  //       and(
  //         eq(chatMessages.senderId, senderId),
  //         eq(chatMessages.recipientId, currentUserId),
  //         eq(chatMessages.isRead, false)
  //       )
  //     );
  //   return true;
  // }

  async markAsRead(currentUserId: string, senderId: string): Promise<boolean> {
    const cleanCurrentUserId = currentUserId.toLowerCase().trim();
    const cleanSenderId = senderId.toLowerCase().trim();

    await this.db
      .update(chatMessages)
      .set({ isRead: true })
      .where(
        and(
          // Жестко приводим к нижнему регистру обе колонки перед сравнением
          sql`lower(cast(${chatMessages.senderId} as text)) = ${cleanSenderId}`,
          sql`lower(cast(${chatMessages.recipientId} as text)) = ${cleanCurrentUserId}`,
          eq(chatMessages.isRead, false)
        )
      );
    return true;
  }
}
