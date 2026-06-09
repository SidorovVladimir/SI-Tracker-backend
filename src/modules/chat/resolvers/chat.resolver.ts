import { Context } from '../../../context';
import { ChatService } from '../service/chat.service';

export const Query = {
  getChatHistory: async (
    _: unknown,
    {
      recipientId,
      limit,
      offset,
    }: { recipientId: string; limit: number; offset: number },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ChatService(db).getChatHistory(
      currentUser.id,
      recipientId,
      limit,
      offset
    );
  },

  getChatUsers: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new ChatService(db).getChatUsers(currentUser.id);
  },

  getChatDialogs: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ChatService(db).getChatDialogs(currentUser.id);
  },

  getTotalUnreadCount: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) return 0; // Для неавторизованных колокольчик просто покажет 0

    return await new ChatService(db).getTotalUnreadCount(currentUser.id);
  },
};

export const Mutation = {
  markAsRead: async (
    _: unknown,
    { senderId }: { senderId: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ChatService(db).markAsRead(currentUser.id, senderId);
  },
};
