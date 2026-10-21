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
        const { deviceId, action, oldData, newData, userId } = job.data || {};

        const device =
          newData?.name || oldData?.name ? newData || oldData : null;
        let deviceIdent = '';

        if (device) {
          deviceIdent = `«${device.name}» (Модель: ${
            device.model || '—'
          }, Зав. №: ${device.serialNumber || '—'})`;
        } else if (deviceId) {
          deviceIdent = `с ID ${deviceId}`;
        }

        const currentBatch = newData?.batchNumber || oldData?.batchNumber;
        const batchNumber = currentBatch ? ` №${currentBatch}` : '';

        let description = '';
        let alertTitle = '⚙️ Действие с оборудованием';
        let alertType: 'info' | 'success' | 'warning' | 'error' = 'info';

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
        } else if (action === 'create_batch') {
          description = `Сформирована новая партия для отправки в ЦСМ на поверку${batchNumber}`;
          alertTitle = '📋 Создана партия на поверку';
          alertType = 'success';
        } else if (action === 'delete_batch') {
          description = `Партия на отправку${batchNumber} удалена из системы`;
          alertTitle = '🗑️ Удаление партии отправки';
          alertType = 'warning';
        } else if (action === 'assign_device_to_batch') {
          description = `Прибор ${deviceIdent} запланирован на отправку и добавлен в партию поверок${batchNumber}`;
          alertTitle = '🚚 Планирование графиков';
          alertType = 'info';
        } else if (action === 'remove_device_to_batch') {
          description = `Прибор ${deviceIdent} исключен из партии отправки${batchNumber} и вернулся в автоматический пул`;
          alertTitle = '🔄 Сброс графика отправки';
          alertType = 'warning';
        } else if (action === 'verify') {
          const docNum = newData?.protocolNumber
            ? ` (Свидетельство/Протокол: ${newData.protocolNumber})`
            : '';
          description = `Успешно зафиксированы результаты контроля прибора ${deviceIdent}. Статус просрочки снят${docNum}`;
          alertTitle = '🔬 Сведения ФГИС Аршин';
          alertType = 'success';
        } else if (action === 'assign_device_to_repair_batch') {
          description = `Прибор ${deviceIdent} распределен в ремонтную ведомость${batchNumber}`;
          alertTitle = '🛠️ Назначение ремонта';
          alertType = 'info';
        } else if (action === 'create_repair_batch') {
          description = `Создана новая ремонтная ведомость${batchNumber}`;
          alertTitle = '📋 Новая ремонтная ведомость';
          alertType = 'success';
        } else if (action === 'delete_repair_batch') {
          description = `Ремонтная ведомость${batchNumber} удалена из системы`;
          alertTitle = '🗑️ Удаление ремонтной ведомости';
          alertType = 'warning';
        } else if (action === 'remove_device_to_repair_batch') {
          description = `Прибор ${deviceIdent} исключен из ремонтной ведомости${batchNumber} и вернулся в очередь на ремонт`;
          alertTitle = '🗑️ Исключение из ремонта';
          alertType = 'warning';
        } else if (action === 'device_scrap') {
          description = `Прибор ${deviceIdent} официально списан и выведен из эксплуатации`;
          alertTitle = '🟥 Списание СИ';
          alertType = 'error';
        } else if (action === 'inspection_batch_create') {
          description = `Сформирована новая ведомость периодических осмотров${batchNumber}`;
          alertTitle = '📋 Новая ведомость осмотров';
          alertType = 'success';
        } else if (action === 'inspection_doc_save') {
          description = `Зафиксирован и сохранен акт технического обслуживания (ТО)${batchNumber} для прибора ${deviceIdent}`;
          alertTitle = '📄 Акт ТО сохранен';
          alertType = 'success';
        }

        await db.insert(deviceAuditLogs).values({
          deviceId: deviceId ?? null,
          userId: userId ?? null,
          action,
          description,
          oldData: oldData ?? null,
          newData: newData ?? null,
        });

        const notificationActions: (typeof action)[] = [
          'create_batch',
          'create_repair_batch',
          'device_scrap',
          'verify',
          'inspection_batch_create',
        ];

        if (notificationActions.includes(action)) {
          await notificationQueue.add('send-notification', {
            type: 'custom-alert',
            payload: {
              userId: null,
              title: alertTitle,
              message: description,
              type: alertType,
            },
          });
        }
      }
    },
    { connection: redisForQueue as any, concurrency: 5 } // Записываем пачками по 5 штук
  );
};
