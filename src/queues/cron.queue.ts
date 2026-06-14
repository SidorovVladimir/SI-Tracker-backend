import { Queue } from 'bullmq';
import { redisForQueue } from '../redis/client';

export const cronQueue = new Queue('cron-jobs', {
  connection: redisForQueue as any,
});

export async function scheduleCronJobs() {
  console.log('[BullMQ] Регистрация регламентных задач (Cron)...');

  // 1. Очистка уведомлений (каждый день в 03:00)
  await cronQueue.add(
    'clean-notifications',
    {},
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'repeatable:clean-notifications',
    }
  );

  // 2. Очистка чата (каждый день в 03:00)
  await cronQueue.add(
    'clean-chat',
    {},
    {
      repeat: { pattern: '0 3 * * *' },
      jobId: 'repeatable:clean-chat',
    }
  );
}
