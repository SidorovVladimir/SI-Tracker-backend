import { Queue } from 'bullmq';
import { redisForQueue } from '../../../redis/client';

export const auditLogQueue = new Queue('audit-logs', {
  connection: redisForQueue as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
    removeOnComplete: true,
  },
});
