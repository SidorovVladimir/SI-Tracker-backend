import { redis } from '../redis/client';

/**
 * Rate limiter на основе Redis sliding window
 * @returns true если запрос разрешен, false если превышен лимит
 */
export async function checkRateLimit(
  userId: string,
  action: string,
  maxRequests: number,
  windowMs: number
): Promise<boolean> {
  try {
    const key = `ratelimit:${action}:${userId}`;
    const current = await redis.incr(key);

    if (current === 1) {
      // Устанавливаем TTL только при первом запросе
      await redis.pexpire(key, windowMs);
    }

    return current <= maxRequests;
  } catch {
    // Если Redis недоступен — разрешаем запрос (graceful degradation)
    return true;
  }
}

// Константы для разных действий
export const RATE_LIMITS = {
  SEND_MESSAGE: { max: 30, windowMs: 60000 }, // 30 сообщений в минуту
  LOGIN: { max: 5, windowMs: 60000 }, // 5 попыток входа в минуту
  REGISTER: { max: 3, windowMs: 60000 }, // 3 регистрации в минуту
  SYNC_ARSHIN: { max: 10, windowMs: 60000 }, // 10 синхронизаций в минуту
  GRAPHQL: { max: 200, windowMs: 60000 }, // 200 GraphQL запросов в минуту
};
