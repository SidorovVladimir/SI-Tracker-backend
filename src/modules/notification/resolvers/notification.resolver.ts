import { Context } from '../../../context';
import { NotificationService } from '../service/notification.service';

export const Query = {
  getSystemNotifications: async (
    _: unknown,
    args: { limit?: number; offset?: number },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    const limit = args.limit ?? 20;
    const offset = args.offset ?? 0;
    const result = await new NotificationService(db).getNotifications({
      userId: currentUser.id,
      limit,
      offset,
    });

    return result;
  },
  getUnreadNotificationsCount: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) return 0;
    return await new NotificationService(db).getUnreadCount(currentUser.id);
  },
};

export const Mutation = {
  markNotificationAsRead: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }
    return await new NotificationService(db).markAsRead(id, currentUser.id);
  },
  markAllNotificationsAsRead: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }
    return await new NotificationService(db).markAllAsRead(currentUser.id);
  },
};
