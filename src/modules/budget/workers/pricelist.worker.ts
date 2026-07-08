import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { db } from '../../../db/client';
import { notificationQueue } from '../../notification/queues/notification.queue';

export const createPricelistWorker = () => {
  return new Worker(
    'pricelist-import',
    async (job: Job) => {
      if (job.name === 'pricelist-import-job') {
        const { metadata, items, userId } = job.data;
        const cleanUserId = String(userId).toLowerCase().trim();

        console.log(
          `[Queue] pricelist-import: ${items?.length || 0} items started`
        );

        const { BudgetService } = await import('../service/budget.service');
        const budgetService = new BudgetService(db);
        const { io } = await import('../../../index');

        try {
          // Шаг A: Сначала атомарно создаем шапку прейскуранта в базе данных
          const newPricelist = await budgetService.createPricelistHeader({
            title: metadata.title,
            year: metadata.year,
            isRegulated: metadata.isRegulated,
            verificationOrganizationId: metadata.verificationOrganizationId,
          });

          if (!newPricelist) {
            throw new Error('Failed to create price');
          }

          const BATCH_SIZE = 100;
          let importedTotal = 0;
          const totalItems = items.length;

          // Шаг B: Наполняем прайс-лист позициями порциями (чанками)
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const chunk = items.slice(i, i + BATCH_SIZE);

            // Метод сервиса, который просто делает пакетный insert строк для конкретного pricelistId
            const imported = await budgetService.insertPricelistItemsChunk(
              newPricelist.id,
              chunk
            );
            importedTotal += imported;

            // Обновляем прогресс в Redis для BullMQ
            await job.updateProgress({
              imported: importedTotal,
              total: totalItems,
            });

            // Отправляем оперативную инфографику на фронтенд через Socket.io
            if (io) {
              io.to(cleanUserId).emit('job-progress', {
                jobId: job.id,
                name: 'pricelist-import',
                current: importedTotal,
                total: totalItems,
                percentage: Math.round((importedTotal / totalItems) * 100),
              });
            }

            // Микро-задержка для того, чтобы не блокировать event loop Node.js
            if (i + BATCH_SIZE < items.length) {
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          // Отправляем системное уведомление в колокольчик (если нужно)
          await notificationQueue.add('send-notification', {
            type: 'pricelist-import-complete',
            payload: {
              userId,
              title: metadata.title,
              importedCount: importedTotal,
            },
          });

          // Шлем финальный сокет-ивент успеха
          if (io) {
            io.to(cleanUserId).emit('job-status-changed', {
              jobId: job.id,
              status: 'completed',
              result: { importedCount: importedTotal, total: totalItems },
            });
          }

          return {
            pricelistId: newPricelist.id,
            importedCount: importedTotal,
            total: totalItems,
          };
        } catch (error: any) {
          console.error(`[Pricelist Worker] ДЕТАЛИ ОШИБКИ БАЗЫ ДАННЫХ:`, error);
          if (error.detail)
            console.error(
              `[Pricelist Worker] Подробности Postgres:`,
              error.detail
            );
          if (error.hint)
            console.error(`[Pricelist Worker] Подсказка Postgres:`, error.hint);

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
    { connection: redisForQueue as any, concurrency: 1 } // Ограничиваем до 1 для последовательной записи прайсов
  );
};
