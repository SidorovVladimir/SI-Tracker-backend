import { and, eq, or, desc, isNull, sql, notExists } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  systemNotifications,
  userNotificationStatuses,
} from '../models/notification.model';
import { io } from '../../../index';

export class NotificationService {
  constructor(private db: DrizzleDB) {}

  // Метод для генерации нового уведомления с любой точки бэкенда!
  async createNotification(data: {
    userId: string | null;
    title: string;
    message: string;
    type?: 'info' | 'success' | 'warning' | 'error';
  }) {
    const [newAlert] = await this.db
      .insert(systemNotifications)
      .values({
        userId: data.userId,
        title: data.title,
        message: data.message,
        type: data.type || 'info',
      })
      .returning();

    if (newAlert) {
      if (data.userId) {
        // Если персональное — шлем конкретному сотруднику
        io.to(data.userId).emit('systemAlertReceived', newAlert);
      } else {
        // Если глобальное — шлем вообще всем подключенным сокетам
        io.emit('systemAlertReceived', newAlert);
      }
    }
    return newAlert;
  }

  // async getNotifications(userId: string) {
  //   return await this.db
  //     .select()
  //     .from(systemNotifications)
  //     .where(
  //       or(
  //         eq(systemNotifications.userId, userId),
  //         isNull(systemNotifications.userId)
  //       )
  //     )
  //     .orderBy(desc(systemNotifications.createdAt))
  //     .limit(20);
  // }
  async getNotifications(userId: string) {
    const cleanUserId = userId.toLowerCase().trim();

    return await this.db
      .select({
        id: systemNotifications.id,
        userId: systemNotifications.userId,
        title: systemNotifications.title,
        message: systemNotifications.message,
        type: systemNotifications.type,
        createdAt: systemNotifications.createdAt,
        // Проверяем прочитано ли оно ИМЕННО ЭТИМ пользователем
        isRead: sql<boolean>`CASE WHEN ${userNotificationStatuses.id} IS NOT NULL THEN true ELSE false END`,
      })
      .from(systemNotifications)
      .leftJoin(
        userNotificationStatuses,
        and(
          eq(userNotificationStatuses.notificationId, systemNotifications.id),
          eq(userNotificationStatuses.userId, cleanUserId)
        )
      )
      .where(
        or(
          eq(systemNotifications.userId, cleanUserId),
          isNull(systemNotifications.userId)
        )
      )
      .orderBy(desc(systemNotifications.createdAt))
      .limit(20);
  }

  // async getUnreadCount(userId: string): Promise<number> {
  //   const cleanUserId = userId.toLowerCase().trim();
  //   const [result] = await this.db
  //     .select({ count: sql<number>`count(*)::int` })
  //     .from(systemNotifications)
  //     .where(
  //       and(
  //         or(
  //           eq(systemNotifications.userId, cleanUserId),
  //           isNull(systemNotifications.userId)
  //         ),
  //         eq(systemNotifications.isRead, false)
  //       )
  //     );
  //   return result?.count ?? 0;
  // }
  async getUnreadCount(userId: string): Promise<number> {
    const cleanUserId = userId.toLowerCase().trim();

    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemNotifications)
      .where(
        and(
          or(
            eq(systemNotifications.userId, cleanUserId),
            isNull(systemNotifications.userId)
          ),
          // Уведомление не должно существовать в таблице прочитанных этим пользователем
          notExists(
            this.db
              .select()
              .from(userNotificationStatuses)
              .where(
                and(
                  eq(
                    userNotificationStatuses.notificationId,
                    systemNotifications.id
                  ),
                  eq(userNotificationStatuses.userId, cleanUserId)
                )
              )
          )
        )
      );

    return result?.count ?? 0;
  }

  // async markAsRead(id: string, userId: string) {
  //   await this.db
  //     .update(systemNotifications)
  //     .set({ isRead: true })
  //     .where(
  //       and(
  //         eq(systemNotifications.id, id),
  //         or(
  //           eq(systemNotifications.userId, userId),
  //           isNull(systemNotifications.userId)
  //         )
  //       )
  //     );
  //   return true;
  // }

  // async markAllAsRead(userId: string) {
  //   await this.db
  //     .update(systemNotifications)
  //     .set({ isRead: true })
  //     .where(
  //       and(
  //         or(
  //           eq(systemNotifications.userId, userId),
  //           isNull(systemNotifications.userId)
  //         ),
  //         eq(systemNotifications.isRead, false)
  //       )
  //     );
  //   return true;
  // }
  async markAsRead(id: string, userId: string) {
    const cleanUserId = userId.toLowerCase().trim();

    // Проверяем, не прочитано ли оно уже, чтобы избежать дубликатов
    const [exists] = await this.db
      .select()
      .from(userNotificationStatuses)
      .where(
        and(
          eq(userNotificationStatuses.notificationId, id),
          eq(userNotificationStatuses.userId, cleanUserId)
        )
      )
      .limit(1);

    if (!exists) {
      await this.db.insert(userNotificationStatuses).values({
        userId: cleanUserId,
        notificationId: id,
        isRead: true,
      });
    }
    return true;
  }

  // 4.ПРОЧТЕНИЕ ВСЕХ: Находим все непрочитанные пользователем и вставляем их пачкой
  async markAllAsRead(userId: string) {
    const cleanUserId = userId.toLowerCase().trim();

    // Находим ID всех уведомлений, которые этот юзер еще не читал
    const unreadNotifications = await this.db
      .select({ id: systemNotifications.id })
      .from(systemNotifications)
      .where(
        and(
          or(
            eq(systemNotifications.userId, cleanUserId),
            isNull(systemNotifications.userId)
          ),
          notExists(
            this.db
              .select()
              .from(userNotificationStatuses)
              .where(
                and(
                  eq(
                    userNotificationStatuses.notificationId,
                    systemNotifications.id
                  ),
                  eq(userNotificationStatuses.userId, cleanUserId)
                )
              )
          )
        )
      );

    if (unreadNotifications.length > 0) {
      const insertValues = unreadNotifications.map((n) => ({
        userId: cleanUserId,
        notificationId: n.id,
        isRead: true,
      }));

      // Массовая вставка (Batch Insert) прочитанных статусов
      await this.db.insert(userNotificationStatuses).values(insertValues);
    }
    return true;
  }
}
