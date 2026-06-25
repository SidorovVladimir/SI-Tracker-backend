import { Queue } from 'bullmq';
import { redisForQueue } from '../../../redis/client';

export const pricelistQueue = new Queue('pricelist-import', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 3600 }, // хранить час в Redis после успеха
    removeOnFail: { age: 24 * 3600 }, // хранить сутки при ошибке
  },
});
