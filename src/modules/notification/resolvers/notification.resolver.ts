import { Context } from '../../../context';
import { NotificationService } from '../service/notification.service';

export const Query = {
  getSystemNotifications: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new NotificationService(db).getNotifications(currentUser.id);
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
    return await new NotificationService(db).markAsRead(id, currentUser.id);
  },
  markAllNotificationsAsRead: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new NotificationService(db).markAllAsRead(currentUser.id);
  },
};
