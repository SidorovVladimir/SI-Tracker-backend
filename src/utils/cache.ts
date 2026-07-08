import Redis from 'ioredis';
import { redis } from '../redis/client';

const DEFAULT_TTL = 3600; // 1 час

export async function getOrCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Redis недоступен — игнорируем, идем в БД
  }

  const data = await fetcher();

  if (data && Array.isArray(data) && data.length === 0) {
    return data;
  }

  try {
    await redis.setex(key, ttl, JSON.stringify(data));
  } catch {}

  return data;
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {}
}

export async function invalidateCachePattern(
  redis: Redis,
  pattern: string
): Promise<void> {
  try {
    // 1. Создаем поток сканирования по нашему паттерну.
    // count: 100 означает, что Redis будет проверять по 100 ключей за итерацию.
    const stream = redis.scanStream({
      match: pattern,
      count: 100,
    });

    // 2. Слушаем событие появления порции найденных ключей
    stream.on('data', async (resultKeys: string[]) => {
      if (resultKeys.length > 0) {
        // Паузим поток, чтобы успеть удалить текущий батч ключей
        stream.pause();

        // Удаляем найденную порцию ключей
        await redis.del(...resultKeys);

        // Возобновляем сканирование
        stream.resume();
      }
    });

    // 3. Возвращаем Promise, который разрешится, когда сканирование полностью завершится
    return new Promise((resolve, reject) => {
      stream.on('end', () => {
        resolve();
      });
      stream.on('error', (err) => {
        console.error('[Cache Helper] Scan stream error:', err);
        reject(err);
      });
    });
  } catch (err) {
    // Если что-то пошло не так на старте — логируем, но приложение не роняем (Graceful degradation)
    console.warn('[Cache Helper] Pattern invalidation failed:', err);
  }
}

// Константы ключей кэша
export const CACHE_KEYS = {
  STATUSES: 'catalog:statuses',
  EQUIPMENT_TYPES: 'catalog:equipment_types',
  MEASUREMENT_TYPES: 'catalog:measurement_types',
  METROLOGY_CONTROL_TYPES: 'catalog:metrology_control_types',
  SCOPES: 'catalog:scopes',
  PRIMARY_STANDARTS: 'catalog:primary_standarts',
  VERIFICATION_ORGANIZATIONS: 'catalog:verification_organizations',
  CITIES: 'catalog:cities',
  COMPANIES: 'catalog:companies',
  PRODUCTION_SITES: 'catalog:production_sites',
  USERS: 'catalog:users',
};
