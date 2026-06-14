import { Queue } from 'bullmq';
import { redisForQueue } from '../../../redis/client';

export const notificationQueue = new Queue('notifications', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'fixed',
      delay: 5000,
    },
    removeOnComplete: {
      age: 600,
    },
  },
});
