import { DrizzleDB } from '../db/client'; // Замените на ваш путь к инстансу базы данных
import { verificationBatches, devicesToBatches, devices } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export interface CreateBatchInput {
  number: string;
  plannedDate: Date;
  verificationOrganizationId?: string | null;
  comment?: string | null;
}

export class VerificationPlanningService {
  constructor(private db: DrizzleDB) {}

  // 1. Создать новую партию (экспедицию) на определенный месяц
  async createBatch(input: CreateBatchInput) {
    const [newBatch] = await this.db
      .insert(verificationBatches)
      .values({
        number: input.number,
        plannedDate: input.plannedDate,
        verificationOrganizationId: input.verificationOrganizationId ?? null,
        comment: input.comment ?? null,
        status: 'draft', // По умолчанию партия всегда создается как черновик
      })
      .returning();

    if (!newBatch) {
      throw new Error('Не удалось создать партию поверок');
    }

    return newBatch;
  }

  // 2. Добавить приборы в партию (Мутация ручного переноса в выбранный месяц)
  async addDevicesToBatch(
    batchId: string,
    deviceIds: string[]
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    await this.db.transaction(async (tx) => {
      // Сначала проверяем, существует ли целевая партия
      const [batch] = await tx
        .select()
        .from(verificationBatches)
        .where(eq(verificationBatches.id, batchId));

      if (!batch) {
        throw new Error('Указанная партия поверок не найдена');
      }

      // Если эти приборы уже были привязаны К ДРУГИМ ЧЕРНОВИКАМ партий,
      // мы удаляем старые связи, чтобы не плодить дубли
      await tx.delete(devicesToBatches).where(
        and(
          inArray(devicesToBatches.deviceId, deviceIds),
          // Проверяем через связь, что удаляем только из черновиков (для безопасности)
          inArray(
            devicesToBatches.batchId,
            tx
              .select({ id: verificationBatches.id })
              .from(verificationBatches)
              .where(eq(verificationBatches.status, 'draft'))
          )
        )
      );

      // Формируем массив новых связей
      const linksToInsert = deviceIds.map((dId) => ({
        batchId: batchId,
        deviceId: dId,
        deviceStatus: 'selected',
      }));

      // Массово вставляем приборы в новую партию
      await tx.insert(devicesToBatches).values(linksToInsert);
    });

    return true;
  }

  // 3. Удалить приборы из партии (Вернуть их обратно в автоматический пул)
  async removeDevicesFromBatch(
    batchId: string,
    deviceIds: string[]
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    await this.db
      .delete(devicesToBatches)
      .where(
        and(
          eq(devicesToBatches.batchId, batchId),
          inArray(devicesToBatches.deviceId, deviceIds)
        )
      );

    return true;
  }

  // 4. Сменить статус партии (например, 'draft' -> 'sent' когда машина уехала в ЦСМ)
  async updateBatchStatus(id: string, status: 'draft' | 'sent' | 'completed') {
    const [updatedBatch] = await this.db
      .update(verificationBatches)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(verificationBatches.id, id))
      .returning();

    if (!updatedBatch) {
      throw new Error('Партия для обновления статуса не найдена');
    }

    return updatedBatch;
  }

  // 5. Получить приборы для конкретного месяца (автоматический пул + ручные переносы)
  // Аргумент targetMonth передается в формате строки "YYYY-MM" (например, "2026-06")
  async getPlanningPoolByMonth(
    targetMonth: string,
    companyDefaultLeadTime = 30
  ) {
    const [targetYearStr, targetMonthStr] = targetMonth.split('-');
    const year = parseInt(targetYearStr, 10);
    const month = parseInt(targetMonthStr, 10);

    // Вычисляем календарные границы выбранного планового месяца (например, с 1 по 30 июня)
    const planStart = new Date(year, month - 1, 1);
    const planEnd = new Date(year, month, 0, 23, 59, 59);

    // 1. Запрашиваем из базы данных ВСЕ приборы, которые не в архиве,
    // вместе с их свежими поверками, типами оборудования и текущими партиями
    const allDevices = await this.db.query.devices.findMany({
      where: eq(devices.archived, false),
      with: {
        equipmentType: true,
        // Запрашиваем связи с партиями, чтобы понять, закреплен ли уже прибор вручную
        devicesToBatches: {
          with: {
            batch: true,
          },
        },
        // Подтягиваем поверки, чтобы узнать актуальную дату окончания validUntil
        verifications: {
          orderBy: (v, { desc }) => [desc(v.validUntil)],
          limit: 1, // Нам нужна только самая последняя поверка
        },
      },
    });

    const pool: any[] = [];

    // 2. Бежим циклом по приборам и вычисляем, куда их отнести
    for (const device of allDevices) {
      const latestVerification = device.verifications?.[0];
      if (!latestVerification || !latestVerification.validUntil) {
        continue; // Если у прибора вообще никогда не было поверок, пропускаем его
      }

      const validUntilDate = new Date(latestVerification.validUntil);

      // Проверяем, закреплен ли прибор за какой-то активной (незакрытой) партией вручную
      const activeBatchLink = device.devicesToBatches?.find(
        (link) =>
          link.batch?.status === 'draft' || link.batch?.status === 'sent'
      );

      // --- СЦЕНАРИЙ А: ПРИБОР УЖЕ ЗАКРЕПЛЕН МЕТРОЛОГОМ ЗА ПАРТИЕЙ ---
      if (activeBatchLink && activeBatchLink.batch) {
        const batchDate = new Date(activeBatchLink.batch.plannedDate);

        // Если месяц и год планирования партии совпадают с искомым месяцем, выводим его
        if (
          batchDate.getFullYear() === year &&
          batchDate.getMonth() + 1 === month
        ) {
          pool.push({
            id: device.id,
            name: device.name,
            model: device.model,
            serialNumber: device.serialNumber,
            validUntil: validUntilDate.toISOString(),
            suggestedMonth: targetMonth, // Месяц совпадает с целевым
            targetBatchId: activeBatchLink.batch.id, // Фронтенд увидит, в какой он партии
            isManualPlacement: true, // Маркер для интерфейса
          });
        }
        continue; // Переходим к следующему прибору
      }

      // --- СЦЕНАРИЙ Б: ПРИБОР НАХОДИТСЯ В СВОБОДНОМ АВТОМАТИЧЕСКОМ ПУЛЕ ---
      // Реализуем каскадный расчет Lead Time:
      // 1. Индивидуальный у прибора -> 2. Из типа оборудования -> 3. Системный дефолт
      const currentLeadTime =
        device.leadTimeDays ??
        device.equipmentType?.leadTimeDays ??
        companyDefaultLeadTime;

      // Сдвигаем дату окончания поверки назад на вычисленный запас дней
      const plannedActionDate = new Date(validUntilDate);
      plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

      // Если сдвинутая дата попадает в рамки искомого месяца — этот прибор автоматически просится сюда
      if (plannedActionDate >= planStart && plannedActionDate <= planEnd) {
        // Дополнительно вычисляем "чистый" месяц автоматики для передачи на фронтенд
        const autoMonth =
          plannedActionDate.getFullYear() +
          '-' +
          String(plannedActionDate.getMonth() + 1).padStart(2, '0');

        pool.push({
          id: device.id,
          name: device.name,
          model: device.model,
          serialNumber: device.serialNumber,
          validUntil: validUntilDate.toISOString(),
          suggestedMonth: autoMonth,
          targetBatchId: null, // Он пока свободен
          isManualPlacement: false,
        });
      }
    }

    // Сортируем полученный список: приборы, у которых раньше всего кончается поверка, будут первыми
    return pool.sort(
      (a, b) =>
        new Date(a.validUntil).getTime() - new Date(b.validUntil).getTime()
    );
  }

  // 6. Получить сводную статистику по месяцам на весь год (для главного экрана календаря)
  async getYearlyCalendarSummary(year: number, companyDefaultLeadTime = 30) {
    const summary: Record<
      string,
      { month: string; autoCount: number; manualCount: number }
    > = {};

    // Инициализируем структуру на все 12 месяцев выбранного года
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${year}-${String(m).padStart(2, '0')}`;
      summary[monthKey] = { month: monthKey, autoCount: 0, manualCount: 0 };
    }

    // Для простоты и скорости переиспользуем расчет пула для каждого месяца года
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${year}-${String(m).padStart(2, '0')}`;
      const monthPool = await this.getPlanningPoolByMonth(
        monthKey,
        companyDefaultLeadTime
      );

      // Считаем сколько в этом месяце автоматических приборов, а сколько закинуто руками
      monthPool.forEach((device) => {
        if (device.isManualPlacement) {
          summary[monthKey].manualCount++;
        } else {
          summary[monthKey].autoCount++;
        }
      });
    }

    return Object.values(summary);
  }
}
