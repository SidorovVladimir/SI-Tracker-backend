import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../redis/client';
import { db } from '../db/client';
import { lt } from 'drizzle-orm';

export const createCronWorker = () => {
  return new Worker(
    'cron-jobs',
    async (job: Job) => {
      if (job.name === 'clean-notifications') {
        console.log(
          '[BullMQ Cron] Запуск регламентной очистки старых уведомлений...'
        );
        const { systemNotifications } = await import(
          '../modules/notification/models/notification.model'
        );

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() - 30); // 30 дней

        await db
          .delete(systemNotifications)
          .where(lt(systemNotifications.createdAt, expiryDate));

        console.log('[BullMQ Cron] Очистка уведомлений успешно завершена.');
        return { success: true };
      }

      if (job.name === 'clean-chat') {
        console.log(
          '[BullMQ Cron] Запуск регламентной очистки старых сообщений чата...'
        );
        const { chatMessages } = await import(
          '../modules/chat/models/message.model'
        );

        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() - 90); // 90 дней

        await db
          .delete(chatMessages)
          .where(lt(chatMessages.createdAt, expiryDate));

        console.log(
          '[BullMQ Cron] Регламентная очистка чата успешно завершена.'
        );
        return { success: true };
      }
    },
    {
      connection: redisForQueue as any,
      concurrency: 1,
    }
  );
};
