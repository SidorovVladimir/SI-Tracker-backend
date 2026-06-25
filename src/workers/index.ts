import { Worker } from 'bullmq';
import { createNotificationWorker } from '../modules/notification/workers/notifications.worker';
import { createArshinWorker } from '../modules/device/workers/archin.worker';
import { createRestoreWorker } from '../modules/admin/workers/restore.worker';
import { createImportWorker } from '../modules/device/workers/import.worker';
import { createCronWorker } from './cron.worker';
import { scheduleCronJobs } from '../queues/cron.queue';
import { createAuditWorker } from '../modules/audit/workers/audit.worker';
import { createPricelistWorker } from '../modules/budget/workers/pricelist.worker';

// Хранилище для запущенных воркеров (пригодится для корректного отключения)
const activeWorkers: Worker[] = [];

export const initAllWorkers = () => {
  console.log('[BullMQ] Инициализация всех фоновых воркеров...');

  // Регистрируем и запускаем каждый воркер
  activeWorkers.push(createRestoreWorker());
  activeWorkers.push(createArshinWorker());
  activeWorkers.push(createImportWorker());
  activeWorkers.push(createCronWorker());
  activeWorkers.push(createNotificationWorker());
  activeWorkers.push(createAuditWorker());
  activeWorkers.push(createPricelistWorker());

  scheduleCronJobs().catch(console.error);
  console.log(`[BullMQ] Успешно запущено воркеров: ${activeWorkers.length}`);
};

// Функция для плавного отключения (Graceful Shutdown)
export const shutdownAllWorkers = async () => {
  console.log('[BullMQ] Остановка всех воркеров...');
  // Закрываем все воркеры параллельно, чтобы они успели дописать текущие задачи
  await Promise.all(activeWorkers.map((worker) => worker.close()));
  console.log('[BullMQ] Все воркеры успешно остановлены.');
};
