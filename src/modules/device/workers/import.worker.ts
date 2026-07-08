import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { db } from '../../../db/client';
import { notificationQueue } from '../../notification/queues/notification.queue';

export const createImportWorker = () => {
  return new Worker(
    'device-import',
    async (job: Job) => {
      if (job.name === 'excel-import-job') {
        const { items, userId } = job.data;
        const cleanUserId = String(userId).toLowerCase().trim();
        console.log(
          `[Queue] device-import: ${items?.length || 0} items started`
        );

        const { DeviceService } = await import('../service/device.service');
        const deviceService = new DeviceService(db);
        const { io } = await import('../../../index');

        try {
          const BATCH_SIZE = 50;
          let importedTotal = 0;
          const totalItems = items.length;

          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const chunk = items.slice(i, i + BATCH_SIZE);
            const imported = await deviceService.importDevicesFromExcel(
              chunk,
              userId
            );
            importedTotal += imported;

            await job.updateProgress({
              imported: importedTotal,
              total: items.length,
            });

            if (io) {
              io.to(cleanUserId).emit('job-progress', {
                jobId: job.id,
                name: 'device-import',
                current: importedTotal,
                total: totalItems,
                percentage: Math.round((importedTotal / totalItems) * 100),
              });
            }

            if (i + BATCH_SIZE < items.length) {
              await new Promise((resolve) => setTimeout(resolve, 200));
            }
          }

          await notificationQueue.add('send-notification', {
            type: 'import-complete',
            payload: { userId, importedCount: importedTotal },
          });

          // Шлем финальный сокет-ивент успеха
          if (io) {
            io.to(cleanUserId).emit('job-status-changed', {
              jobId: job.id,
              status: 'completed',
              result: { importedCount: importedTotal, total: totalItems },
            });
          }

          return { importedCount: importedTotal, total: items.length };
        } catch (error: any) {
          console.error(
            `[Import Worker] КРИТИЧЕСКИЙ СБОЙ ИМПОРТА:`,
            error.message
          );

          // Отправляем уведомление об ошибке в колокольчик
          // await notificationQueue.add('send-notification', {
          //   type: 'import-failed',
          //   payload: { userId, importedTotal: 0, total: items.length },
          // });

          // Шлем сокет-ивент падения
          if (io) {
            io.to(cleanUserId).emit('job-status-changed', {
              jobId: job.id,
              status: 'failed',
              error: error.message,
            });
          }
          throw error;
        }
      }
    },
    { connection: redisForQueue as any, concurrency: 2 }
  );
};
