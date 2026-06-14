import { Queue } from 'bullmq';
import { redisForQueue } from '../../../redis/client';

export const importQueue = new Queue('device-import', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 24 * 3600 },
  },
});
