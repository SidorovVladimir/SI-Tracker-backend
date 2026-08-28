import { sql, eq } from 'drizzle-orm';
import { db } from './client';
import { devices } from '../modules/device/models/device.model';
import { DeviceService } from '../modules/device/service/device.service';

// Предполагается, что инстанс вашей БД импортируется отсюда

async function runPrimaryMetrologyMigration() {
  console.log('🚀 [MIGRATION] Запуск первичного заполнения кэша метрологии...');
  const startTime = Date.now();

  // 1. Получаем общее количество приборов, у которых кэш еще НЕ заполнен
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(devices)
    .where(sql`${devices.cachedControl} IS NULL`);

  const totalToMigrate = countResult?.count ?? 0;
  console.log(`📦 Найдено приборов без кэша: ${totalToMigrate}`);

  if (totalToMigrate === 0) {
    console.log(
      '✅ Все приборы уже имеют заполненный кэш. Миграция не требуется.'
    );
    return;
  }

  const batchSize = 500; // Оптимальный размер пачки для удержания памяти Node.js и PGlite/Postgres
  let processedCount = 0;
  let errorCount = 0;

  const deviceService = new DeviceService(db);

  // Идем циклом, пока остаются записи с cachedControl IS NULL
  while (processedCount < totalToMigrate) {
    // Выбираем строго ID следующей пачки неприборов
    const batch = await db
      .select({ id: devices.id })
      .from(devices)
      .where(sql`${devices.cachedControl} IS NULL`)
      .limit(batchSize);

    if (batch.length === 0) break;

    console.log(
      `🔄 Обработка пачки приборов: с ${processedCount + 1} по ${
        processedCount + batch.length
      }...`
    );

    // Запускаем пересчет параллельно внутри одной пачки через Promise.all
    // Каждый вызов внутри себя откроет мини-транзакцию/запрос к БД
    await Promise.all(
      batch.map(async (device) => {
        try {
          await deviceService.updateMetrologyCache(db, device.id);
        } catch (err: any) {
          errorCount++;
          console.error(
            `❌ Ошибка пересчета кэша для прибора ID: ${device.id}. Причина: ${
              err?.message || err
            }`
          );
        }
      })
    );

    processedCount += batch.length;

    // Выводим промежуточный прогресс в консоль
    const percentage = ((processedCount / totalToMigrate) * 100).toFixed(1);
    console.log(
      `📊 Прогресс: ${processedCount}/${totalToMigrate} (${percentage}%) завершено. Ошибок: ${errorCount}`
    );
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n🏁 [MIGRATION COMPLETED] Миграция данных завершена за ${durationSec} сек!`
  );
  console.log(`✅ Успешно обработано приборов: ${processedCount - errorCount}`);
  console.log(`❌ Пропущено из-за ошибок: ${errorCount}`);
}

// Запуск скрипта
runPrimaryMetrologyMigration().catch((err) => {
  console.error(
    '💥 Критическая ошибка во время выполнения скрипта миграции:',
    err
  );
});
