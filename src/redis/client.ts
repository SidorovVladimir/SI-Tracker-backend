import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 200, 3000);
  },
  enableOfflineQueue: false,
  keepAlive: 5000,
});

export const redisForQueue = new Redis(REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    return 2000;
  },
  enableOfflineQueue: true,
  keepAlive: 5000,
});

const handleRedisError = (clientName: string) => (err: any) => {
  if (err?.code === 'ECONNREFUSED') {
    console.warn(
      `[Redis ${clientName}] Warning: Connection refused. Check if Redis server is running.`
    );
  } else {
    console.error(`[Redis ${clientName}] error:`, err.message);
  }
};

redis.on('error', handleRedisError('GraphQL'));
redis.on('connect', () => console.log('[Redis GraphQL] Connected'));
redis.on('close', () => {
  console.log('[Redis] Connection closed');
});

redisForQueue.on('error', handleRedisError('Queue'));
redisForQueue.on('connect', () => console.log('[Redis Queue] Connected'));
redisForQueue.on('close', () => {
  console.log('[Redis] Connection closed');
});

const shutdownRedis = async () => {
  console.log('Closing Redis connections...');
  await Promise.all([redis.quit(), redisForQueue.quit()]);
};

process.on('SIGINT', shutdownRedis);
process.on('SIGTERM', shutdownRedis);
