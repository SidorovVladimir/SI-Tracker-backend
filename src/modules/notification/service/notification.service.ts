import { and, eq, or, desc, isNull, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { systemNotifications } from '../models/notification.model';
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
      // 🎯 Стреляем в сокет!
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

  async getNotifications(userId: string) {
    return await this.db
      .select()
      .from(systemNotifications)
      .where(
        or(
          eq(systemNotifications.userId, userId),
          isNull(systemNotifications.userId)
        )
      )
      .orderBy(desc(systemNotifications.createdAt))
      .limit(20);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemNotifications)
      .where(
        and(
          eq(systemNotifications.userId, userId),
          eq(systemNotifications.isRead, false)
        )
      );
    return result?.count ?? 0;
  }

  async markAsRead(id: string, userId: string) {
    await this.db
      .update(systemNotifications)
      .set({ isRead: true })
      .where(
        and(
          eq(systemNotifications.id, id),
          eq(systemNotifications.userId, userId)
        )
      );
    return true;
  }

  async markAllAsRead(userId: string) {
    await this.db
      .update(systemNotifications)
      .set({ isRead: true })
      .where(
        and(
          eq(systemNotifications.userId, userId),
          eq(systemNotifications.isRead, false)
        )
      );
    return true;
  }
}
