import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { db } from '../../../db/client';
import { notificationQueue } from '../../notification/queues/notification.queue'; // Ваша очередь уведомлений
// import { io } from '../../..';

export const createArshinWorker = () => {
  console.log('Start arshin worker');
  return new Worker(
    'arshin-sync', // Имя очереди должно строго совпадать с Queue
    async (job: Job) => {
      // Проверяем имя задачи, отправленное через arshinQueue.add('sync-batch')
      if (job.name === 'sync-batch') {
        const { batchId, userId } = job.data;
        console.log(
          `[Queue Worker] arshin-sync: Задача обнаружена. Партия=${batchId}`
        );

        // Динамический импорт сервиса для предотвращения циклических зависимостей
        const { DeviceService } = await import('../service/device.service');
        const deviceService = new DeviceService(db);

        const { io } = await import('../../../index');

        const cleanUserId = String(userId).toLowerCase().trim();
        try {
          const result = await deviceService.executeBatchArshinSync(
            batchId,
            userId,
            async (current, total) => {
              await job.updateProgress({ current, total });

              if (io && userId) {
                // Шлём строго в UUID комнату
                io.to(cleanUserId).emit('job-progress', {
                  jobId: job.id,
                  name: 'arshin-sync',
                  current,
                  batchId,
                  total,
                  percentage: Math.round((current / total) * 100),
                });
              }
            }
          );

          if (io && userId) {
            io.to(cleanUserId).emit('job-status-changed', {
              jobId: job.id,
              batchId,
              name: 'arshin-sync',
              status: 'completed',
              result,
            });
          }

          await notificationQueue.add('send-notification', {
            type: 'arshin-sync-complete',
            payload: {
              userId,
              syncedCount: result.syncedCount,
              totalCount: result.totalCount,
            },
          });

          return result;
        } catch (error: any) {
          if (io && userId) {
            io.to(cleanUserId).emit('job-status-changed', {
              jobId: job.id,
              status: 'failed',
              name: 'arshin-sync',
              batchId,
              error: error.message,
            });
          }
          throw error;
        }
      }
    },
    {
      connection: redisForQueue as any,
      concurrency: 1, // Важно: строго по очереди, без параллельных запросов к Аршину!
    }
  );
};
