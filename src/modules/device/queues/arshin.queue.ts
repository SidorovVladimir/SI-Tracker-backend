import { Queue } from 'bullmq';
import { redisForQueue } from '../../../redis/client';

export const arshinQueue = new Queue('arshin-sync', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: {
      age: 24 * 3600, // Хранить упавшие задачи 24 часа для анализа логов
    },
  },
});
