import cron from 'node-cron';
import { lt } from 'drizzle-orm';
import { db } from '../../../db/client';
import { chatMessages } from '../models/message.model';

export const initChatCleanerCron = () => {
  cron.schedule('0 3 * * *', async () => {
    console.log(
      '🧹 [CRON] Запуск регламентной очистки старых сообщений чата...'
    );
    try {
      // 1. Вычисляем временную отсечку (текущая дата минус 90 дней)
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() - 90);

      // 2. Универсальный чистый делит без возврата значений
      await db
        .delete(chatMessages)
        .where(lt(chatMessages.createdAt, expiryDate));

      console.log(`✅ [CRON] Регламентная очистка чата успешно завершена.`);
    } catch (error) {
      console.error(
        '❌ [CRON] Критическая ошибка при автоматической очистке чата:',
        error
      );
    }
  });
};
