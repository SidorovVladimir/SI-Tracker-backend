import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { db } from '../../../db/client';

export const createNotificationWorker = () => {
  return new Worker(
    'notifications',
    async (job: Job) => {
      const { type, payload } = job.data;
      console.log(`[Queue] notification: ${type} started`);

      const { NotificationService } = await import(
        '../service/notification.service'
      );
      const notificationService = new NotificationService(db);

      try {
        switch (type) {
          case 'arshin-sync-complete':
            await notificationService.createNotification({
              userId: payload.userId,
              title: '🔬 Синхронизация с Аршин завершена',
              message: `Синхронизация партии завершена. Обработано: ${payload.syncedCount}/${payload.totalCount}`,
              type:
                payload.syncedCount === payload.totalCount
                  ? 'success'
                  : 'warning',
            });
            break;
          case 'arshin-sync-failed':
            await notificationService.createNotification({
              userId: payload.userId,
              title: '⚠️ Синхронизация с Аршин завершилась с ошибками',
              message: `Произошел сбой при обработке партии. Проверьте логи или повторите попытку.`,
              type: 'error',
            });
            break;
          case 'import-complete':
            await notificationService.createNotification({
              userId: payload.userId,
              title: '📦 Импорт завершен',
              message: `Импортировано ${payload.importedCount} приборов из Excel.`,
              type: 'success',
            });
            break;
          case 'import-failed':
            await notificationService.createNotification({
              userId: payload.userId,
              title: '❌ Ошибка при импорте',
              message: `Не удалось завершить фоновую загрузку файла оборудования.`,
              type: 'error',
            });
            break;
          default:
            await notificationService.createNotification({
              userId: payload.userId || null,
              title: payload.title || 'Системное уведомление',
              message: payload.message || 'Нет данных',
              type:
                (payload.type as 'info' | 'success' | 'warning' | 'error') ||
                'info',
            });
        }
        console.log(
          `[Queue Worker] Уведомление ${type} успешно обработано и отправлено.`
        );
      } catch (error: any) {
        console.error(`[Queue] notification: ${type} FAILED:`, error.message);
        throw error;
      }
    },
    { connection: redisForQueue as any, concurrency: 3 }
  );
};
