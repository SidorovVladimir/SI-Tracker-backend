import { Worker, Job } from 'bullmq';
import { redisForQueue } from '../../../redis/client';
import { db } from '../../../db/client';
import { deviceAuditLogs } from '../auditLog.model';
import { notificationQueue } from '../../notification/queues/notification.queue';

export const createAuditWorker = () => {
  return new Worker(
    'audit-logs',
    async (job: Job) => {
      if (job.name === 'write-audit-log') {
        const { deviceId, action, oldData, newData, userId } = job.data;

        const device = newData || oldData;
        const deviceIdent = device
          ? `«${device.name}» (Модель: ${device.model}, Зав. №: ${device.serialNumber})`
          : `с ID ${deviceId}`;

        let description = '';
        let alertTitle = '⚙️ Действие с оборудованием';
        let alertType: 'info' | 'success' | 'warning' | 'error' = 'info';

        // Ваша готовая логика распределения текстов
        if (action === 'create') {
          description = `Добавлен прибор в систему: ${deviceIdent}`;
          alertTitle = '📦 Новый прибор';
          alertType = 'success';
        } else if (action === 'delete') {
          description = `Удален прибор из системы: ${deviceIdent}`;
          alertTitle = '🗑️ Удаление оборудования';
          alertType = 'warning';
        } else if (action === 'update') {
          description = `Обновлены данные прибора: ${deviceIdent}`;
          alertTitle = '📝 Изменение паспорта СИ';
          alertType = 'info';
        } else if (action === 'assign_batch') {
          const batchNumber = newData?.batchNumber
            ? ` №${newData.batchNumber}`
            : '';
          description = `Прибор ${deviceIdent} запланирован на отправку и добавлен в партию поверок${batchNumber}`;
          alertTitle = '🚚 Планирование графиков';
          alertType = 'info';
        } else if (action === 'remove_batch') {
          description = `Прибор ${deviceIdent} исключен из партии отправки и вернулся в автоматический пул`;
          alertTitle = '🔄 Сброс графика отправки';
          alertType = 'warning';
        } else if (action === 'verify') {
          const docNum = newData?.protocolNumber
            ? ` (Свидетельство/Протокол: ${newData.protocolNumber})`
            : '';
          description = `Успешно зафиксированы результаты контроля прибора ${deviceIdent}. Статус просрочки снят${docNum}`;
          alertTitle = '🔬 Сведения ФГИС Аршин';
          alertType = 'success';
        }

        // 1. Асинхронно пишем в таблицу аудит-логов PostgreSQL через Drizzle
        await db.insert(deviceAuditLogs).values({
          deviceId,
          userId: userId ?? null,
          action,
          description,
          oldData: oldData ?? null,
          newData: newData ?? null,
        });

        // 🔥 2. Разделяем обязанности! Вместо синхронного вызова сервиса,
        // отправляем задачу в нашу фоновую очередь уведомлений
        await notificationQueue.add('send-notification', {
          type: 'custom-alert',
          payload: {
            userId: null, // Глобальное уведомление (для всех метрологов)
            title: alertTitle,
            message: description,
            type: alertType,
          },
        });
      }
    },
    { connection: redisForQueue as any, concurrency: 5 } // Записываем пачками по 5 штук
  );
};
