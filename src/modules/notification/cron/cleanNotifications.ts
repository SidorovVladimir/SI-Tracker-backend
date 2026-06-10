import cron from 'node-cron';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client';
import { systemNotifications } from '../models/notification.model';

export const initNotificationCleanerCron = () => {
  cron.schedule('0 3 * * *', async () => {
    console.log('[CRON] Запуск регламентной очистки старых уведомлений...');
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() - 30); // Храним системные алерты 30 дней

      await db
        .delete(systemNotifications)
        .where(lt(systemNotifications.createdAt, expiryDate));
    } catch (error) {
      console.error(
        '[CRON] Критическая ошибка при автоматической очистке уведомлений:',
        error
      );
    }
  });
};
