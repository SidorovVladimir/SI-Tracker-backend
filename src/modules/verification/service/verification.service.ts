import { DrizzleDB } from '../../../db/client'; // Замените на ваш путь к инстансу базы данных
import { DeviceAuditLogService } from '../../audit/auditLog.service';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices } from '../../device/models/device.model';
import {
  eq,
  and,
  inArray,
  sql,
  gte,
  lte,
  desc,
  notInArray,
  or,
  asc,
  SQL,
  isNull,
  ilike,
  SQLWrapper,
} from 'drizzle-orm';
import { verificationOrganizations } from '../../catalog/models/verificationOrganization.model';
import { DeviceService } from '../../device/service/device.service';
import { CreateVerificationDto } from '../dto/CreateVerificationDto';
import {
  arshinVerificationBuffer,
  devicesToBatches,
  verificationBatches,
  verifications,
} from '../models/verification.model';
import { statuses } from '../../catalog/models/status.model';

export interface CreateBatchInput {
  // number: string;
  plannedDate: Date;
  verificationOrganizationId?: string | null | undefined;
  comment?: string | null | undefined;
}

export interface PlanningPoolItem {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  validUntil: string | null;
  suggestedMonth: string;
  targetBatchId: string | null;
  isManualPlacement: boolean;
  controlType: string; // Передаем тип контроля на фронтенд для фильтров
  isOverdue: boolean;
}

export class VerificationPlanningService {
  constructor(
    private db: DrizzleDB,
    private auditLogService?: DeviceAuditLogService,
    private deviceService?: DeviceService
  ) {}

  // 1. Создать новую партию на определенный месяц
  async createBatch(input: CreateBatchInput, currentUser: string) {
    const year = input.plannedDate.getFullYear();
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    const [lastBatch] = await this.db
      .select({ number: verificationBatches.number })
      .from(verificationBatches)
      .where(
        and(
          gte(verificationBatches.plannedDate, startOfYear),
          lte(verificationBatches.plannedDate, endOfYear),
          eq(verificationBatches.type, 'verification')
        )
      )
      .orderBy(desc(verificationBatches.createdAt))
      .limit(1);

    let nextSequenceNumber = 1;

    if (lastBatch && lastBatch.number) {
      const lastNumberStr = lastBatch.number;

      const match = lastNumberStr.match(/\d+$/);

      if (match) {
        const lastSequence = parseInt(match[0], 10);
        if (!isNaN(lastSequence)) {
          nextSequenceNumber = lastSequence + 1;
        }
      }
    }
    const formattedSequence = String(nextSequenceNumber).padStart(3, '0');

    const [newBatch] = await this.db
      .insert(verificationBatches)
      .values({
        number: `П-${year}/${formattedSequence}`,
        plannedDate: input.plannedDate,
        verificationOrganizationId: input.verificationOrganizationId ?? null,
        comment: input.comment ?? null,
        status: 'draft', // По умолчанию партия всегда создается как черновик
        createdById: currentUser,
      })
      .returning();

    if (!newBatch) {
      throw new Error('Не удалось создать партию поверок');
    }

    return newBatch;
  }

  async addDevicesToBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    let logsToRecord: any[] = [];
    let recordedBatchNumber = '';

    await this.db.transaction(async (tx) => {
      // 1. Проверяем существование партии (Быстро, 1 запрос по ID)
      const [batch] = await tx
        .select({
          id: verificationBatches.id,
          status: verificationBatches.status,
          number: verificationBatches.number,
        })
        .from(verificationBatches)
        .where(eq(verificationBatches.id, batchId));

      if (!batch) {
        throw new Error('Указанная партия поверок не найдена');
      }
      if (batch.status !== 'draft') {
        throw new Error(
          'Нельзя добавлять приборы в отправленную/закрытую партию'
        );
      }

      recordedBatchNumber = batch.number;

      // 2. ОПТИМИЗАЦИЯ СБОРКА ДАННЫХ ДЛЯ ЛОГОВ (Вместо цикла из 500 запросов — делаем 1 МАССОВЫЙ SELECT)
      // Используем inArray по первичному ключу. База выдаст все приборы за 1-2 миллисекунды.
      const devicesData = await tx
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
        })
        .from(devices)
        .where(inArray(devices.id, deviceIds));

      logsToRecord = devicesData;

      // 3. ОПТИМИЗАЦИЯ УДАЛЕНИЯ (Разбиваем сложный вложенный запрос на два простых действия)
      // Сначала находим ID всех черновиков партий
      const draftBatches = await tx
        .select({ id: verificationBatches.id })
        .from(verificationBatches)
        .where(eq(verificationBatches.status, 'draft'));

      const draftBatchIds = draftBatches.map((b) => b.id);

      // Удаляем старые связи приборов одним чистым запросом по массивам ID (мгновенно по индексам)
      if (draftBatchIds.length > 0) {
        await tx
          .delete(devicesToBatches)
          .where(
            and(
              inArray(devicesToBatches.deviceId, deviceIds),
              inArray(devicesToBatches.batchId, draftBatchIds)
            )
          );
      }

      // 4. Массово вставляем приборы в новую партию (Один батч-инсерт)
      const linksToInsert = deviceIds.map((dId) => ({
        batchId: batchId,
        deviceId: dId,
        deviceStatus: 'selected',
      }));

      await tx.insert(devicesToBatches).values(linksToInsert);
    });

    // 5. ЗАПИСЬ В ЖУРНАЛ АУДИТА (Вне транзакции, чтобы не держать блокировки БД)
    if (this.auditLogService && logsToRecord.length > 0) {
      await Promise.all(
        logsToRecord.map((logItem) =>
          this.auditLogService!.logAction({
            deviceId: logItem.id,
            action: 'assign_batch',
            newData: {
              batchId,
              batchNumber: recordedBatchNumber,
              name: logItem.name,
              model: logItem.model,
              serialNumber: logItem.serialNumber,
            },
            userId,
          })
        )
      );
    }

    return true;
  }

  async removeDevicesFromBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    let logsToRecord: any[] = [];
    let isBatchDeleted = false;

    // 1. АТОМАРНАЯ ТРАНЗАКЦИЯ (Только сверхбыстрые дисковые операции)
    await this.db.transaction(async (tx) => {
      const [targetBatch] = await tx
        .select({ status: verificationBatches.status })
        .from(verificationBatches)
        .where(eq(verificationBatches.id, batchId))
        .limit(1);

      if (!targetBatch) {
        throw new Error('Партия не найдена в системе.');
      }
      const devicesData = await tx
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
        })
        .from(devices)
        .where(inArray(devices.id, deviceIds));

      logsToRecord = devicesData;

      if (targetBatch.status === 'sent') {
        const [statusHealthy] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(statuses.name, 'исправен'))
          .limit(1);

        for (const deviceId of deviceIds) {
          // Вытаскиваем сохраненный слепок статуса для этого прибора из этой партии
          const [savedLink] = await tx
            .select({ previousStatusId: devicesToBatches.previousStatusId })
            .from(devicesToBatches)
            .where(
              and(
                eq(devicesToBatches.batchId, batchId),
                eq(devicesToBatches.deviceId, deviceId)
              )
            )
            .limit(1);
          const targetStatusId =
            savedLink?.previousStatusId || statusHealthy?.id;

          if (targetStatusId) {
            await tx
              .update(devices)
              .set({ statusId: targetStatusId, updatedAt: new Date() })
              .where(eq(devices.id, deviceId));
          }
        }
      }

      await tx
        .delete(devicesToBatches)
        .where(
          and(
            eq(devicesToBatches.batchId, batchId),
            inArray(devicesToBatches.deviceId, deviceIds)
          )
        );

      // 3. ПРОВЕРКА НА ПУСТОТУ: Считаем, сколько приборов ОСТАЛОСЬ в этой партии
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(devicesToBatches)
        .where(eq(devicesToBatches.batchId, batchId));

      // 4. Если в партии осталось 0 приборов — полностью удаляем саму партию
      if (!remaining || remaining.count === 0) {
        await tx
          .delete(verificationBatches)
          .where(eq(verificationBatches.id, batchId));

        isBatchDeleted = true;
      }
    });

    // ЗДЕСЬ ТРАНЗАКЦИЯ УСПЕШНО ЗАКРЫЛАСЬ, ВСЕ БЛОКИРОВКИ С ТАБЛИЦ СНЯТЫ!

    // 5. БЕЗОПАСНАЯ ЗАПИСЬ В ЖУРНАЛ АУДИТА ВНЕ ТРАНЗАКЦИИ (Параллельно через Promise.all)
    if (this.auditLogService && logsToRecord.length > 0) {
      await Promise.all(
        logsToRecord.map((logItem) =>
          this.auditLogService!.logAction({
            deviceId: logItem.id,
            action: 'remove_batch',
            oldData: {
              batchId,
              isBatchDeleted, // Передаем флаг, если партия была уничтожена за ненадобностью
              name: logItem.name,
              model: logItem.model,
              serialNumber: logItem.serialNumber,
            },
            userId,
          })
        )
      );
    }

    return true;
  }

  // 4. Сменить статус партии (например, 'draft' -> 'sent' когда машина уехала в ЦСМ)
  async updateBatchStatus(id: string, status: 'draft' | 'sent' | 'completed') {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const [currentBatch] = await tx
        .select()
        .from(verificationBatches)
        .where(eq(verificationBatches.id, id))
        .limit(1);

      if (!currentBatch) {
        throw new Error('Партия для обновления статуса не найдена');
      }

      const [updatedBatch] = await tx
        .update(verificationBatches)
        .set({
          status,
          updatedAt: now,
        })
        .where(eq(verificationBatches.id, id))
        .returning();

      const deviceToBatchesList = await tx
        .select()
        .from(devicesToBatches)
        .where(eq(devicesToBatches.batchId, id));

      if (!deviceToBatchesList.length) {
        return updatedBatch;
      }

      const deviceIds = deviceToBatchesList.map((db) => db.deviceId);

      if (status === 'sent') {
        const [statusOnVerification] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(statuses.name, 'на поверке (в цсм)'))
          .limit(1);

        if (!statusOnVerification) {
          throw new Error(
            'Статус "на поверке (в цсм)" не найден в справочнике!'
          );
        }

        for (const deviceLink of deviceToBatchesList) {
          const [currentDevice] = await tx
            .select({ statusId: devices.statusId })
            .from(devices)
            .where(eq(devices.id, deviceLink.deviceId))
            .limit(1);

          if (currentDevice?.statusId) {
            await tx
              .update(devicesToBatches)
              .set({ previousStatusId: currentDevice.statusId })
              .where(eq(devicesToBatches.id, deviceLink.id));
          }
        }

        await tx
          .update(devices)
          .set({ statusId: statusOnVerification.id, updatedAt: now })
          .where(inArray(devices.id, deviceIds));
      }
      return updatedBatch;
    });
  }

  async getPlanningPoolByMonth(
    targetMonth: string, // Формат "YYYY-MM"
    companyDefaultLeadTime = 30,
    limit = 20,
    offset = 0,
    controlTypeId?: string
  ) {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;
    const currentMonthStart = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}-01`;

    // Исключаемые статусы (в базе они гарантированно в нижнем регистре)
    const excludedStatuses = [
      'длительное хранение',
      'неисправен',
      'забракован',
      'утерян',
      'не годен',
      'списан',
    ];

    // -------------------------------------------------------------------------
    // ЧАСТЬ 1: ПОДГОТОВКА СЛОЖНОГО SQL-ФИЛЬТРА ДЛЯ ПЛАНИРОВАНИЯ
    // Расчет планового месяца отправки (next_verification_date - lead_time_days)
    // -------------------------------------------------------------------------

    // Вычисляем плановую дату за вычетом Lead Time прямо в Postgres/PGlite
    const calculatedActionDateSql = sql`
    (${devices.nextVerificationDate}::date - COALESCE(${devices.leadTimeDays}, ${companyDefaultLeadTime}) * INTERVAL '1 day')
  `;

    // Вычисляем строковый ключ года-месяца "YYYY-MM" для этой даты
    const autoMonthKeySql = sql`to_char(${calculatedActionDateSql}, 'YYYY-MM')`;

    // Ключевое правило: если прибор из прошлого (долг), его целевой месяц — текущий. Иначе — его родной.
    const finalTargetMonthSql = sql`
    CASE 
      WHEN ${calculatedActionDateSql} < ${currentMonthStart}::date THEN ${currentMonthKey}
      ELSE ${autoMonthKeySql}
    END
  `;

    const basePoolConditions = [
      eq(devices.archived, false),
      // eq(devices.scheduleStatus, 'active'),
      notInArray(
        devices.statusId,
        this.db
          .select({ id: statuses.id })
          .from(statuses)
          .where(inArray(statuses.name, excludedStatuses))
      ),
      sql`${devices.cachedControl} != 'осмотр'`,
      sql`${devices.nextVerificationDate} IS NOT NULL`,
    ];

    const scenarioACondition = sql`
      EXISTS (
        SELECT 1 FROM devices_to_batches dtb
        JOIN verification_batches vb ON dtb.batch_id = vb.id
        WHERE dtb.device_id = ${devices.id}
          AND vb.status IN ('draft', 'sent')
          AND vb.type = 'verification'
          AND to_char(vb.planned_date, 'YYYY-MM') = ${targetMonth}
      )
    `;

    const scenarioBCondition = sql`
      NOT EXISTS (
        SELECT 1 FROM devices_to_batches dtb
        JOIN verification_batches vb ON dtb.batch_id = vb.id
        WHERE dtb.device_id = ${devices.id} 
          AND vb.status IN ('draft', 'sent')
          AND vb.type = 'verification'
      ) AND ${finalTargetMonthSql} = ${targetMonth}
    `;

    // 🌟 ГЛОБАЛЬНЫЙ ФИЛЬТР МЕСЯЦА (Чистый, без привязки к конкретной вкладке)
    const whereGlobalMonth = and(
      ...basePoolConditions,
      or(scenarioACondition, scenarioBCondition)
    );

    // =========================================================================
    // ЧАСТЬ 2: ДИНАМИЧЕСКИЙ ФИЛЬТР ДЛЯ СТРОК ТЕКУЩЕЙ ВКЛАДКИ
    // =========================================================================
    const pageConditions = [...basePoolConditions];

    // if (controlTypeId && controlTypeId !== 'ALL') {
    //   if (controlTypeId === 'NOT_SPECIFIED') {
    //     pageConditions.push(
    //       or(
    //         sql`${devices.cachedControl} IS NULL`,
    //         eq(devices.cachedControl, 'не указан')
    //       ) as SQL
    //     );
    //   } else {
    //     pageConditions.push(
    //       sql`${devices.cachedControl} = (SELECT LOWER(name) FROM metrology_controle_types WHERE id = ${controlTypeId})`
    //     );
    //   }
    // }
    if (controlTypeId && controlTypeId !== 'ALL') {
      if (controlTypeId === 'PAUSED') {
        // 🔥 ВЫБРАН ТАБ «РЕЗЕРВ»: Вытаскиваем приборы этого месяца, которые стоят на паузе
        pageConditions.push(
          inArray(devices.scheduleStatus, ['paused_all', 'paused_verification'])
        );
      } else {
        // ВЫБРАНЫ СТАНДАРТНЫЕ ТАБЫ (Поверка, Калибровка): Приборы на паузе должны быть СКРЫТЫ!
        pageConditions.push(eq(devices.scheduleStatus, 'active'));

        if (controlTypeId === 'NOT_SPECIFIED') {
          pageConditions.push(
            or(
              isNull(devices.cachedControl),
              eq(devices.cachedControl, 'не указан')
            ) as SQL
          );
        } else {
          pageConditions.push(
            sql`${devices.cachedControl} = (SELECT LOWER(name) FROM metrology_controle_types WHERE id = ${controlTypeId})`
          );
        }
      }
    } else {
      pageConditions.push(eq(devices.scheduleStatus, 'active'));
    }

    // Итоговое условие для пагинации строк конкретного таба
    const finalWhereClause = and(
      ...pageConditions,
      or(scenarioACondition, scenarioBCondition)
    );

    // =========================================================================
    // ЧАСТЬ 3: БЫСТРЫЕ АГРЕГАЦИИ СЧЕТЧИКОВ (Считаем по ГЛОБАЛЬНОМУ фильтру)
    // =========================================================================
    const typeCountsQuery = await this.db
      .select({
        controlType: devices.cachedControl,
        count: sql<number>`count(*)::int`,
      })
      .from(devices)
      .where(and(whereGlobalMonth, eq(devices.scheduleStatus, 'active')))

      .groupBy(devices.cachedControl);

    let unassignedCount = 0;
    const typeCounts = typeCountsQuery
      .map((row) => {
        if (!row.controlType || row.controlType === 'не указан') {
          unassignedCount += row.count;
          return null;
        }
        return { typeName: row.controlType, count: row.count };
      })
      .filter(Boolean);

    // 🌟 СЧЕТЧИК ТАБА «ВСЕ ПРИБОРЫ» (Всегда показывает полную сумму за месяц)
    const [globalCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(and(whereGlobalMonth, eq(devices.scheduleStatus, 'active')));

    const globalTotalCount = globalCountResult?.count ?? 0;
    const [pausedCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(
        and(
          whereGlobalMonth,
          inArray(devices.scheduleStatus, ['paused_all', 'paused_verification']) // Вытаскиваем паузы
        )
      );

    const pausedTotalCount = pausedCountResult?.count ?? 0;

    // СЧЕТЧИК СТРОК ТЕКУЩЕЙ ВКЛАДКИ (Нужен для пагинации DataGrid)
    const [pageCountResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(finalWhereClause);

    const pageTotalCount = pageCountResult?.count ?? 0;

    if (globalTotalCount === 0 && pausedTotalCount === 0) {
      return {
        items: [],
        totalCount: 0,
        meta: {
          unassignedCount: 0,
          typeCounts: [],
          globalTotalCount: 0,
          pausedTotalCount: 0,
        },
      };
    }

    // =========================================================================
    // ЧАСТЬ 4: ПОЛУЧЕНИЕ СТРОК (Тут жестко по finalWhereClause с лимитами)
    // =========================================================================
    const paginatedDevices = await this.db.query.devices.findMany({
      where: finalWhereClause, // Вытягиваем только строки выбранного таба
      limit,
      offset,
      orderBy: (d) => [asc(d.nextVerificationDate)],
      columns: {
        id: true,
        name: true,
        model: true,
        serialNumber: true,
        cachedControl: true,
        nextVerificationDate: true,
        scheduleStatus: true,
      },
      with: {
        devicesToBatches: {
          with: { batch: true },
          where: sql`batch_id IN (SELECT id FROM verification_batches WHERE status IN ('draft', 'sent'))`,
        },
        verifications: {
          orderBy: (v, { desc }) => [desc(v.date)],
          limit: 5,
          with: { metrologyControleType: true },
        },
      },
    });

    // -------------------------------------------------------------------------
    // ЧАСТЬ 5: ЛЕГКИЙ МАППИНГ СТРАНИЦЫ ИЗ 20 ШТУК
    // -------------------------------------------------------------------------
    const items = paginatedDevices.map((device) => {
      const activeBatchLink = device.devicesToBatches?.[0] || null;
      // const latestVerification = device.verifications?.[0] || null;

      const latestMetrologyDoc =
        device.verifications?.find(
          (v: any) =>
            v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
        ) ||
        device.verifications?.[0] ||
        null; // Если вдруг ничего кроме осмотров нет, берем что есть

      const isManualPlacement = !!activeBatchLink;
      const targetBatchId = activeBatchLink?.batch?.id || null;

      return {
        id: device.id,
        name: device.name,
        model: device.model,
        serialNumber: device.serialNumber,
        validUntil: device.nextVerificationDate
          ? new Date(device.nextVerificationDate).toISOString()
          : null,
        lastControlDate: latestMetrologyDoc?.date
          ? new Date(latestMetrologyDoc.date).toISOString()
          : null,
        suggestedMonth: targetMonth,
        targetBatchId,
        isManualPlacement,
        controlType: device.cachedControl || 'не указан',
        scheduleStatus: device.scheduleStatus,
        isOverdue: device.nextVerificationDate
          ? new Date(device.nextVerificationDate) < now
          : false,
      };
    });

    // return {
    //   items,
    //   totalCount: pageTotalCount,
    //   meta: {
    //     unassignedCount,
    //     typeCounts,
    //   },
    // };
    return {
      items,
      totalCount: pageTotalCount,
      meta: {
        globalTotalCount,
        unassignedCount,
        typeCounts,
        pausedTotalCount,
      },
    };
  }

  async getYearlyCalendarSummary(year: number, companyDefaultLeadTime = 30) {
    const now = new Date();

    // Текущий рабочий месяц (например, "2026-08")
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;
    // Начало текущего месяца в виде объекта даты для быстрого сравнения таймстампов
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Исключаемые статусы (гарантированно в нижнем регистре в БД)
    const excludedStatuses = [
      'длительное хранение',
      'неисправен',
      'забракован',
      'утерян',
      'не годен',
      'списан',
    ];

    // Инициализируем пустую структуру для 12 месяцев запрашиваемого года
    const summary: Record<
      string,
      { month: string; autoCount: number; manualCount: number }
    > = {};
    for (let m = 1; m <= 12; m++) {
      const monthKey = `${year}-${String(m).padStart(2, '0')}`;
      summary[monthKey] = { month: monthKey, autoCount: 0, manualCount: 0 };
    }

    // 1. Извлекаем плоский подзапрос для получения месяцев активных партий
    const activeBatches = await this.db
      .select({
        deviceId: devicesToBatches.deviceId,
        plannedDate: verificationBatches.plannedDate,
      })
      .from(devicesToBatches)
      .innerJoin(
        verificationBatches,
        eq(devicesToBatches.batchId, verificationBatches.id)
      )
      .where(
        and(
          inArray(verificationBatches.status, ['draft', 'sent']),
          eq(verificationBatches.type, 'verification')
        )
      );

    // Храним связи приборов и месяцев их партий в Map для моментального поиска за O(1)
    const batchMonthsMap = new Map<string, string>();
    for (const b of activeBatches) {
      if (b.plannedDate) {
        const pDate = new Date(b.plannedDate);
        const mKey = `${pDate.getFullYear()}-${String(
          pDate.getMonth() + 1
        ).padStart(2, '0')}`;
        batchMonthsMap.set(b.deviceId, mKey);
      }
    }

    const maxDateLimit = `${year + 1}-02-28`;

    // 2. Выгребаем из базы только те приборы, которые активны, не в осмотре и имеют даты (Сверхбыстрый Index Scan)
    // Мы запрашиваем ТОЛЬКО 3 легких поля, база не будет тратить ресурсы
    const activeDevices = await this.db
      .select({
        id: devices.id,
        nextVerificationDate: devices.nextVerificationDate,
        leadTimeDays: devices.leadTimeDays,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.scheduleStatus, 'active'),
          sql`${devices.cachedControl} != 'осмотр'`,
          sql`${devices.nextVerificationDate} IS NOT NULL`,
          lte(devices.nextVerificationDate, maxDateLimit),
          notInArray(
            devices.statusId,
            this.db
              .select({ id: statuses.id })
              .from(statuses)
              .where(inArray(statuses.name, excludedStatuses))
          )
        )
      );

    // 3. Обрабатываем приборы на стороне Node.js (Для 100k плоских объектов это займет 2-4 миллисекунды)
    for (const device of activeDevices) {
      const batchMonthKey = batchMonthsMap.get(device.id);

      // СЦЕНАРИЙ А: Прибор закреплен за активной партией
      if (batchMonthKey) {
        if (summary[batchMonthKey]) {
          summary[batchMonthKey].manualCount++;
        }
        continue;
      }

      // СЦЕНАРИЙ Б: Автоматический расчет (Вариант Б)
      const currentLeadTime = device.leadTimeDays ?? companyDefaultLeadTime;

      // Явно указываем TypeScript, что мы ожидаем массив из трех гарантированных чисел
      const [dYear, dMonth, dDay] = device
        .nextVerificationDate!.split('-')
        .map(Number) as [number, number, number];

      const plannedActionDate = new Date(dYear, dMonth - 1, dDay);

      // Вычитаем Lead Time дней
      plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

      // Вычисляем плановый месяц отправки
      const actionYear = plannedActionDate.getFullYear();
      const actionMonthStr = String(plannedActionDate.getMonth() + 1).padStart(
        2,
        '0'
      );
      const deviceAutoMonthKey = `${actionYear}-${actionMonthStr}`;

      // Проверяем, долг ли это из прошлого
      const isDeviceOverdueInPast = plannedActionDate < currentMonthStart;

      // Ключевое правило: долги — в текущий месяц, остальное — по графику
      const finalTargetMonth = isDeviceOverdueInPast
        ? currentMonthKey
        : deviceAutoMonthKey;

      // Инкрементируем счетчик, если месяц попал в наш искомый календарный год
      if (summary[finalTargetMonth]) {
        summary[finalTargetMonth].autoCount++;
      }
    }

    // Возвращаем массив из 12 объектов для фронтенда
    return Object.values(summary);
  }

  async getVerificationBatches(
    year?: number,
    status?: string,
    type?: 'verification' | 'inspection' | 'repair',
    limit?: number,
    offset?: number
  ) {
    const constraints = [];

    if (status) {
      constraints.push(eq(verificationBatches.status, status));
    }

    if (year) {
      const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
      const endDate = new Date(`${year}-12-31T23:59:59.999Z`);
      constraints.push(
        and(
          gte(verificationBatches.plannedDate, startDate),
          lte(verificationBatches.plannedDate, endDate)
        )
      );
    }

    const targetType = type ?? 'verification';
    constraints.push(eq(verificationBatches.type, targetType));

    // ПОТОК 1: Извлекаем строго плоский список партий с пагинацией (Мгновенно)
    const batches = await this.db.query.verificationBatches.findMany({
      where: constraints.length > 0 ? and(...constraints) : undefined,
      orderBy: (b, { desc }) => [desc(b.plannedDate)],
      limit,
      offset,
      with: {
        createdBy: true,
        verificationOrganization: true,
      },
    });

    if (batches.length === 0) return [];

    const batchIds = batches.map((b) => b.id);

    // ПОТОК 2: Забираем все приборы, привязанные к ЭТИМ партиям за ОДИН проход
    const relationsData = await this.db
      .select({
        batchId: devicesToBatches.batchId,
        deviceToBatchId: devicesToBatches.id,
        deviceStatus: devicesToBatches.deviceStatus,
        createdAt: devicesToBatches.createdAt,
        // Данные прибора
        deviceId: devices.id,
        deviceName: devices.name,
        deviceModel: devices.model,
        deviceSerialNumber: devices.serialNumber,
      })
      .from(devicesToBatches)
      .innerJoin(devices, eq(devicesToBatches.deviceId, devices.id))
      .where(inArray(devicesToBatches.batchId, batchIds));

    // Если в партиях нет приборов, возвращаем партии как есть
    if (relationsData.length === 0) {
      return batches.map((b) => ({ ...b, devicesToBatches: [] }));
    }

    const uniqueDeviceIds = Array.from(
      new Set(relationsData.map((r) => r.deviceId))
    );

    // ПОТОК 3: Параллельно вытаскиваем верификации и буфер только для нужных приборов
    const [allVerifications, allArshinBuffers] = await Promise.all([
      this.db.query.verifications.findMany({
        where: inArray(verifications.deviceId, uniqueDeviceIds),
        orderBy: (v, { desc }) => [desc(v.date)],
        // 🔥 УВЕЛИЧИВАЕМ ЗАПАС: Берем последние 5 документов прибора, чтобы цеховые осмотры не затирали гоповерки
        limit: uniqueDeviceIds.length * 5,
        with: { metrologyControleType: true, verificationOrganization: true },
      }),
      this.db.query.arshinVerificationBuffer.findMany({
        where: inArray(arshinVerificationBuffer.deviceId, uniqueDeviceIds),
        orderBy: (ab, { desc }) => [desc(ab.verificationDate)],
      }),
    ]);

    // Группируем верификации и буферы по deviceId в Map для O(1) доступа
    const verificationsMap = new Map<string, typeof allVerifications>();
    for (const v of allVerifications) {
      if (!verificationsMap.has(v.deviceId))
        verificationsMap.set(v.deviceId, []);
      verificationsMap.get(v.deviceId)!.push(v);
    }

    const arshinMap = new Map<string, typeof allArshinBuffers>();
    for (const ab of allArshinBuffers) {
      if (!arshinMap.has(ab.deviceId)) arshinMap.set(ab.deviceId, []);
      arshinMap.get(ab.deviceId)!.push(ab);
    }

    // ПОТОК 4: Собираем финальное дерево связей на стороне Node.js
    const batchRelationsMap = new Map<string, any[]>();

    for (const rel of relationsData) {
      const deviceVerifications = verificationsMap.get(rel.deviceId) || [];

      // 🔥 🔥 ГЛАВНОЕ ИСПРАВЛЕНИЕ: Ищем документ под тип конкретного журнала
      let matchedVerification: any = null;

      // if (targetType === 'verification') {
      //   // Мы в Журнале ПОВЕРОК: ищем самый свежий документ, который НЕ является осмотром
      //   matchedVerification = deviceVerifications.find(
      //     (v) =>
      //       v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
      //   );
      // } else {
      //   // Мы в Журнале ОСМОТРОВ: ищем самый свежий документ, который ЯВЛЯЕТСЯ осмотром
      //   matchedVerification = deviceVerifications.find(
      //     (v) =>
      //       v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
      //   );
      // }
      if (targetType === 'verification') {
        // Мы в Журнале ПОВЕРОК: ищем самый свежий документ, который НЕ является осмотром
        matchedVerification = deviceVerifications.find(
          (v) =>
            v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
        );
      } else if (targetType === 'inspection') {
        // Мы в Журнале ОСМОТРОВ: ищем самый свежий документ, который ЯВЛЯЕТСЯ осмотром
        matchedVerification = deviceVerifications.find(
          (v) =>
            v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
        );
      } else if (targetType === 'repair') {
        // 🌟 МЫ В ЖУРНАЛЕ РЕМОНТОВ: Ищем абсолютно самый свежий документ в истории СИ,
        // так как ремонт может закрываться как Поверкой, так и Осмотром/Калибровкой
        matchedVerification =
          deviceVerifications.length > 0 ? deviceVerifications[0] : null;
      }

      // Если по какому-то прибору истории нужного типа еще нет, берем самую последнюю запись как фоллбэк
      if (!matchedVerification && deviceVerifications.length > 0) {
        matchedVerification = deviceVerifications[0];
      }

      const latestVerification = matchedVerification
        ? [matchedVerification]
        : [];
      const deviceArshinBuffers = arshinMap.get(rel.deviceId) || [];

      const deviceToBatchNode = {
        id: rel.deviceToBatchId,
        deviceId: rel.deviceId,
        batchId: rel.batchId,
        deviceStatus: rel.deviceStatus,
        createdAt: rel.createdAt,
        device: {
          id: rel.deviceId,
          name: rel.deviceName,
          model: rel.deviceModel,
          serialNumber: rel.deviceSerialNumber,
          verifications: latestVerification, // Сюда улетит юридически чистый документ!
          arshinBuffers: deviceArshinBuffers,
        },
      };

      if (!batchRelationsMap.has(rel.batchId))
        batchRelationsMap.set(rel.batchId, []);
      batchRelationsMap.get(rel.batchId)!.push(deviceToBatchNode);
    }

    return batches.map((b) => ({
      ...b,
      devicesToBatches: batchRelationsMap.get(b.id) || [],
    }));
  }

  async deleteBatch(id: string): Promise<boolean> {
    const [batch] = await this.db
      .select()
      .from(verificationBatches)
      .where(eq(verificationBatches.id, id));

    if (!batch) {
      throw new Error('Партия не найдена');
    }

    if (batch.status !== 'draft') {
      throw new Error(
        'Нельзя удалить партию, которая уже отправлена или завершена'
      );
    }

    // await this.db
    //   .delete(verificationBatches)
    //   .where(eq(verificationBatches.id, id));

    await this.db.transaction(async (tx) => {
      if (batch.type === 'repair') {
        // Вытягиваем все приборы из этой партии
        const linkedDevices = await tx
          .select()
          .from(devicesToBatches)
          .where(eq(devicesToBatches.batchId, id));

        const [statusBroken] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(statuses.name, 'неисправен'))
          .limit(1);

        for (const link of linkedDevices) {
          // Восстанавливаем оригинальный брак (например, "забракован"), который был до ремонта
          const targetStatusId = link.previousStatusId || statusBroken?.id;

          if (targetStatusId) {
            await tx
              .update(devices)
              .set({ statusId: targetStatusId, updatedAt: new Date() })
              .where(eq(devices.id, link.deviceId));
          }

          // Запускаем пересчет кэша, чтобы вернуть приборы в Журнал ремонта как «требующие внимания»
          if (this.deviceService) {
            await this.deviceService.updateMetrologyCache(tx, link.deviceId);
          }
        }
      }

      // Каскадно удаляем связи (хотя для devicesToBatches у вас стоит onDelete: cascade,
      // явное удаление в рамках транзакции — это хорошая практика)
      await tx.delete(devicesToBatches).where(eq(devicesToBatches.batchId, id));

      // Удаляем саму партию
      await tx
        .delete(verificationBatches)
        .where(eq(verificationBatches.id, id));
    });

    return true;
  }

  // async getDraftBatchesByMonth(plannedMonth: string) {
  //   return await this.db
  //     .select({
  //       id: verificationBatches.id,
  //       number: verificationBatches.number,
  //     })
  //     .from(verificationBatches)
  //     .where(
  //       and(
  //         eq(verificationBatches.status, 'draft'),
  //         sql`to_char(${verificationBatches.plannedDate}, 'YYYY-MM') = ${plannedMonth}`
  //       )
  //     );
  // }

  async getDraftBatchesByMonth(
    plannedMonth?: string,
    type: 'verification' | 'inspection' | 'repair' = 'verification'
  ) {
    const conditions: (SQLWrapper | undefined)[] = [
      eq(verificationBatches.status, 'draft'),
      eq(verificationBatches.type, type),
    ];

    // Если передан месяц (для поверок/осмотров) — добавляем фильтр по датам
    if (plannedMonth) {
      conditions.push(
        sql`to_char(${verificationBatches.plannedDate}, 'YYYY-MM') = ${plannedMonth}`
      );
    }

    return await this.db
      .select({
        id: verificationBatches.id,
        number: verificationBatches.number,
      })
      .from(verificationBatches)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(verificationBatches.createdAt));
  }

  // async confirmArshinBufferRecord(bufferId: string, userId: string) {
  //   return await this.db.transaction(async (tx) => {
  //     // 1. Извлекаем выбранную запись из буфера
  //     const [bufferRecord] = await tx
  //       .select()
  //       .from(arshinVerificationBuffer)
  //       .where(eq(arshinVerificationBuffer.id, bufferId))
  //       .limit(1);

  //     if (!bufferRecord) {
  //       throw new Error(
  //         'Выбранная запись в буфере Аршина не найдена или уже была обработана.'
  //       );
  //     }

  //     const {
  //       deviceId,
  //       batchId,
  //       orgTitle,
  //       vriId,
  //       docNum,
  //       verificationDate,
  //       validDate,
  //       applicability,
  //     } = bufferRecord;

  //     // 2. Находим ID типа метрологического контроля "Поверка"
  //     const [controlType] = await tx
  //       .select()
  //       .from(metrologyControleTypes)
  //       .where(sql`lower(trim(${metrologyControleTypes.name})) = 'поверка'`)
  //       .limit(1);

  //     if (!controlType) {
  //       throw new Error(
  //         'В справочнике типов контроля не найден тип "Поверка".'
  //       );
  //     }

  //     // 3. Разбираемся с организацией: ищем существующую или создаем новую
  //     let orgId: string;
  //     const cleanOrgTitle = orgTitle.toLowerCase().trim();

  //     const [existingOrg] = await tx
  //       .select()
  //       .from(verificationOrganizations)
  //       .where(eq(verificationOrganizations.name, cleanOrgTitle))
  //       .limit(1);

  //     if (existingOrg) {
  //       orgId = existingOrg.id;
  //     } else {
  //       const [newOrg] = await tx
  //         .insert(verificationOrganizations)
  //         .values({ name: cleanOrgTitle })
  //         .returning();

  //       if (!newOrg) {
  //         throw new Error('Не удалось сохранить поверяющую организацию.');
  //       }
  //       orgId = newOrg.id;
  //     }

  //     const verificationDto = {
  //       deviceId: deviceId,
  //       batchId: batchId ?? null,
  //       protocolNumber: docNum,
  //       result: applicability ? 'Годен' : 'Не годен',
  //       documentUrl: `https://fgis.gost.ru/fundmetrology/cm/results/${vriId}`,
  //       date: verificationDate,
  //       validUntil: validDate,
  //       metrologyControleTypeId: controlType.id,
  //       verificationOrganizationId: orgId,
  //       comment: `Подтверждено метрологом из буфера совпадений Аршина. ID записи: ${vriId}`,
  //       cost: 0,
  //     };

  //     await this.createVerification(verificationDto, userId);

  //     // // 4. Переносим данные в чистовую таблицу поверок verifications
  //     // await tx.insert(verifications).values({
  //     //   deviceId: deviceId,
  //     //   batchId: batchId,
  //     //   protocolNumber: docNum,
  //     //   result: applicability ? 'Годен' : 'Не годен',
  //     //   documentUrl: `https://fgis.gost.ru/fundmetrology/cm/results/${vriId}`,
  //     //   date: verificationDate,
  //     //   validUntil: validDate,
  //     //   metrologyControleTypeId: controlType.id,
  //     //   verificationOrganizationId: orgId,
  //     //   comment: `Подтверждено метрологом из буфера совпадений Аршина. ID записи: ${vriId}`,
  //     //   cost: '0.00',
  //     // });

  //     // 5. Если запись привязана к партии — обновляем статус прибора в этой партии на 'returned'
  //     if (batchId) {
  //       await tx
  //         .update(devicesToBatches)
  //         .set({ deviceStatus: 'returned' })
  //         .where(
  //           and(
  //             eq(devicesToBatches.deviceId, deviceId),
  //             eq(devicesToBatches.batchId, batchId)
  //           )
  //         );

  //       // 6. Полностью очищаем весь буфер для ЭТОГО прибора в рамкам ЭТОЙ партии
  //       // (удаляем выбранную запись и остальные ошибочные варианты коллизии)
  //       await tx
  //         .delete(arshinVerificationBuffer)
  //         .where(
  //           and(
  //             eq(arshinVerificationBuffer.deviceId, deviceId),
  //             eq(arshinVerificationBuffer.batchId, batchId)
  //           )
  //         );
  //     } else {
  //       // Если синхронизация была одиночной вне партии, удаляем только записи этого прибора без привязки к batchId
  //       await tx
  //         .delete(arshinVerificationBuffer)
  //         .where(eq(arshinVerificationBuffer.deviceId, deviceId));
  //     }

  //     return { success: true };
  //   });
  // }

  async confirmArshinBufferRecord(bufferId: string, userId: string) {
    const now = new Date();
    let oldDataSnapshot: any = null;

    // 1. Извлекаем запись из буфера АРШИН до транзакции, чтобы знать deviceId для аудита
    const [bufferRecordCheck] = await this.db
      .select({ deviceId: arshinVerificationBuffer.deviceId })
      .from(arshinVerificationBuffer)
      .where(eq(arshinVerificationBuffer.id, bufferId))
      .limit(1);

    if (bufferRecordCheck && this.deviceService) {
      oldDataSnapshot = await this.deviceService.getFlatAuditSnapshot(
        bufferRecordCheck.deviceId
      );
    }

    // 2. Запускаем единую атомарную транзакцию
    const { verificationDto, deviceExists, verificationRecord } =
      await this.db.transaction(async (tx) => {
        const [bufferRecord] = await tx
          .select()
          .from(arshinVerificationBuffer)
          .where(eq(arshinVerificationBuffer.id, bufferId))
          .limit(1);

        if (!bufferRecord) {
          throw new Error(
            'Выбранная запись в буфере Аршина не найдена или уже была обработана.'
          );
        }

        const {
          deviceId,
          batchId,
          orgTitle,
          vriId,
          docNum,
          verificationDate,
          validDate,
          applicability,
        } = bufferRecord;

        const [controlType] = await tx
          .select()
          .from(metrologyControleTypes)
          .where(eq(metrologyControleTypes.name, 'поверка'))
          .limit(1);

        if (!controlType) {
          throw new Error(
            'В справочнике типов контроля не найден тип "Поверка".'
          );
        }

        let orgId: string;
        const cleanOrgTitle = orgTitle.toLowerCase().trim();

        const [existingOrg] = await tx
          .select()
          .from(verificationOrganizations)
          .where(eq(verificationOrganizations.name, cleanOrgTitle))
          .limit(1);

        if (existingOrg) {
          orgId = existingOrg.id;
        } else {
          const [newOrg] = await tx
            .insert(verificationOrganizations)
            .values({ name: cleanOrgTitle })
            .returning();

          if (!newOrg) {
            throw new Error('Не удалось сохранить поверяющую организацию.');
          }
          orgId = newOrg.id;
        }

        const verificationDto = {
          deviceId: deviceId,
          batchId: batchId ?? null,
          protocolNumber: docNum,
          result: applicability ? 'годен' : 'не годен',
          documentUrl: `https://fgis.gost.ru/fundmetrology/cm/results/${vriId}`,
          date: verificationDate,
          validUntil: validDate,
          metrologyControleTypeId: controlType.id,
          verificationOrganizationId: orgId,
          comment: `Подтверждено метрологом из буфера совпадений Аршина. ID записи: ${vriId}`,
          cost: 0,
        };

        // 🎯 ВЫЗОВ ПРИВАТНОГО ЯДРА: передаем контекст 'tx' напрямую в метод создания поверки
        const { verificationRecord, deviceExists } =
          await this.executeCreateVerification(
            verificationDto,
            userId,
            tx,
            now
          );

        if (batchId) {
          await tx
            .update(devicesToBatches)
            .set({ deviceStatus: 'returned' })
            .where(
              and(
                eq(devicesToBatches.deviceId, deviceId),
                eq(devicesToBatches.batchId, batchId)
              )
            );

          await tx
            .delete(arshinVerificationBuffer)
            .where(
              and(
                eq(arshinVerificationBuffer.deviceId, deviceId),
                eq(arshinVerificationBuffer.batchId, batchId)
              )
            );
        } else {
          await tx
            .delete(arshinVerificationBuffer)
            .where(eq(arshinVerificationBuffer.deviceId, deviceId));
        }

        return { verificationDto, deviceExists, verificationRecord };
      });

    // 3. Вызываем аудит только после успешного коммита транзакции
    await this.handleVerificationAudit(
      verificationDto,
      userId,
      deviceExists,
      verificationRecord,
      oldDataSnapshot
    );

    return { success: true };
  }

  async createVerification(input: CreateVerificationDto, userId: string) {
    // let logDeviceData: any = null;
    const now = new Date();

    let oldDataSnapshot: any = null;
    if (this.deviceService) {
      oldDataSnapshot = await this.deviceService.getFlatAuditSnapshot(
        input.deviceId
      );
    }

    const { verificationRecord, deviceExists } = await this.db.transaction(
      async (tx) => {
        return await this.executeCreateVerification(input, userId, tx, now);
      }
    );

    await this.handleVerificationAudit(
      input,
      userId,
      deviceExists,
      verificationRecord,
      oldDataSnapshot
    );

    return verificationRecord;
  }

  // private async executeCreateVerification(
  //   input: CreateVerificationDto,
  //   userId: string,
  //   tx: any,
  //   now: Date
  // ) {
  //   const [deviceExists] = await tx
  //     .select()
  //     .from(devices)
  //     .where(eq(devices.id, input.deviceId));

  //   if (!deviceExists) {
  //     throw new Error('Указанное оборудование не найдено в системе');
  //   }

  //   const [verificationRecord] = await tx
  //     .insert(verifications)
  //     .values({
  //       deviceId: input.deviceId,
  //       batchId: input.batchId ?? null,
  //       protocolNumber: input.protocolNumber,
  //       result: input.result,
  //       date: input.date,
  //       validUntil: input.validUntil ?? null,
  //       documentUrl: input.documentUrl ?? null,
  //       metrologyControleTypeId: input.metrologyControleTypeId,
  //       verificationOrganizationId: input.verificationOrganizationId,
  //       comment: input.comment ?? null,
  //       cost:
  //         input.cost !== undefined && input.cost !== null
  //           ? String(input.cost)
  //           : '0.00',
  //     })
  //     .returning();

  //   if (!verificationRecord) {
  //     throw new Error('Не удалось сохранить данные поверки');
  //   }

  //   let targetStatusId = deviceExists.statusId;

  //   if (input.result === 'Не годен') {
  //     const [rejectedStatus] = await tx
  //       .select({ id: statuses.id })
  //       .from(statuses)
  //       .where(sql`lower(trim(${statuses.name})) IN ('забракован')`);
  //     if (rejectedStatus) targetStatusId = rejectedStatus.id;
  //   } else if (input.result === 'Годен') {
  //     const [activeStatus] = await tx
  //       .select({ id: statuses.id })
  //       .from(statuses)
  //       .where(eq(sql`lower(trim(${statuses.name}))`, 'исправен'));
  //     if (activeStatus) targetStatusId = activeStatus.id;
  //   }

  //   await tx
  //     .update(devices)
  //     .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
  //     .where(eq(devices.id, input.deviceId));

  //   return { verificationRecord, deviceExists };
  // }

  private async executeCreateVerification(
    input: CreateVerificationDto,
    userId: string,
    tx: any,
    now: Date
  ) {
    const [deviceExists] = await tx
      .select()
      .from(devices)
      .where(eq(devices.id, input.deviceId));

    if (!deviceExists) {
      throw new Error('Указанное оборудование не найдено в системе');
    }
    if (input.protocolNumber) {
      const normalizedProtocolNumber = input.protocolNumber
        .trim()
        .toLowerCase();

      const [existingVerification] = await tx
        .select({ id: verifications.id })
        .from(verifications)
        .where(
          and(
            eq(verifications.deviceId, input.deviceId),
            eq(verifications.protocolNumber, normalizedProtocolNumber)
          )
        );

      if (existingVerification) {
        throw new Error(
          `Поверка с номером протокола "${input.protocolNumber}" для данного оборудования уже существует`
        );
      }
    }

    const [verificationRecord] = await tx
      .insert(verifications)
      .values({
        deviceId: input.deviceId,
        batchId: input.batchId ?? null,
        protocolNumber: input.protocolNumber
          ? input.protocolNumber.trim().toLowerCase()
          : null,
        result: input.result.trim().toLowerCase(),
        date: input.date,
        validUntil: input.validUntil ?? null,
        documentUrl: input.documentUrl ?? null,
        metrologyControleTypeId: input.metrologyControleTypeId,
        verificationOrganizationId: input.verificationOrganizationId ?? null,
        comment: input.comment ?? null,
        cost:
          input.cost !== undefined && input.cost !== null
            ? String(input.cost)
            : '0.00',
      })
      .returning();

    if (!verificationRecord) {
      throw new Error('Не удалось сохранить данные поверки');
    }

    // let targetStatusId = deviceExists.statusId;

    // // Оптимизируем поиск статусов: убираем lower(trim) из левой части SQL, так как в БД всё в нижнем регистре
    // if (input.result === 'не годен') {
    //   const [rejectedStatus] = await tx
    //     .select({ id: statuses.id })
    //     .from(statuses)
    //     .where(eq(statuses.name, 'забракован'));
    //   if (rejectedStatus) targetStatusId = rejectedStatus.id;
    // } else if (input.result === 'годен') {
    //   const [activeStatus] = await tx
    //     .select({ id: statuses.id })
    //     .from(statuses)
    //     .where(eq(statuses.name, 'исправен'));
    //   if (activeStatus) targetStatusId = activeStatus.id;
    // }

    // // Обновляем статус прибора
    // await tx
    //   .update(devices)
    //   .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
    //   .where(eq(devices.id, input.deviceId));

    if (this.deviceService) {
      await this.deviceService.updateMetrologyCache(tx, input.deviceId);
    }

    return { verificationRecord, deviceExists };
  }

  private async handleVerificationAudit(
    input: CreateVerificationDto,
    userId: string,
    deviceExists: any,
    verificationRecord: any,
    oldDataSnapshot: any
  ) {
    if (!this.auditLogService) return;

    let newDataSnapshot: any = null;
    if (this.deviceService) {
      newDataSnapshot = await this.deviceService.getFlatAuditSnapshot(
        input.deviceId
      );
    }

    await this.auditLogService.logAction({
      deviceId: input.deviceId,
      action: 'verify',
      newData: {
        protocolNumber: input.protocolNumber,
        result: input.result,
        name: deviceExists.name,
        model: deviceExists.model,
        serialNumber: deviceExists.serialNumber,
        cost: verificationRecord.cost ? parseFloat(verificationRecord.cost) : 0,
      },
      userId,
    });

    if (oldDataSnapshot && newDataSnapshot) {
      await this.auditLogService.logAction({
        deviceId: input.deviceId,
        action: 'update',
        oldData: oldDataSnapshot,
        newData: newDataSnapshot,
        userId,
      });
    }
  }

  async createRepairBatch(
    input: {
      plannedDate: Date;
      comment?: string | null | undefined;
    },
    currentUser: string
  ) {
    const year = input.plannedDate.getFullYear();
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    // Ищем последний ремонтный батч за этот год для инкремента номера
    const [lastBatch] = await this.db
      .select({ number: verificationBatches.number })
      .from(verificationBatches)
      .where(
        and(
          gte(verificationBatches.plannedDate, startOfYear),
          lte(verificationBatches.plannedDate, endOfYear),
          eq(verificationBatches.type, 'repair') // 🌟 Фильтруем строго по ремонту
        )
      )
      .orderBy(desc(verificationBatches.createdAt))
      .limit(1);

    let nextSequenceNumber = 1;

    if (lastBatch && lastBatch.number) {
      const match = lastBatch.number.match(/\d+$/);
      if (match) {
        const lastSequence = parseInt(match[0], 10);
        if (!isNaN(lastSequence)) {
          nextSequenceNumber = lastSequence + 1;
        }
      }
    }
    const formattedSequence = String(nextSequenceNumber).padStart(3, '0');

    const [newBatch] = await this.db
      .insert(verificationBatches)
      .values({
        number: `Р-${year}/${formattedSequence}`, // 🌟 Префикс «Р» — ремонтная накладная
        plannedDate: input.plannedDate,
        verificationOrganizationId: null, // Для ремонта ЦСМ по умолчанию не нужен
        comment: input.comment ?? null,
        status: 'draft', // Создается как черновик, куда КИПиА накидывает приборы
        type: 'repair', // 🌟 ЖЕСТКИЙ МАРКЕР: это ремонтная партия
        createdById: currentUser,
      })
      .returning();

    if (!newBatch) {
      throw new Error('Не удалось создать ремонтную ведомость');
    }

    return newBatch;
  }
  async addDevicesToRepairBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    let logsToRecord: any[] = [];
    let recordedBatchNumber = '';
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // 1. Проверяем существование ремонтной партии
      const [batch] = await tx
        .select({
          id: verificationBatches.id,
          status: verificationBatches.status,
          number: verificationBatches.number,
        })
        .from(verificationBatches)
        .where(
          and(
            eq(verificationBatches.id, batchId),
            eq(verificationBatches.type, 'repair')
          )
        );

      if (!batch) {
        throw new Error('Указанная ремонтная ведомость не найдена');
      }
      if (batch.status !== 'draft') {
        throw new Error(
          'Нельзя добавлять приборы в закрытую ремонтную накладную'
        );
      }

      recordedBatchNumber = batch.number;

      // 2. Вытаскиваем технические характеристики и текущий статус приборов (одним SELECT)
      const devicesData = await tx
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
          statusId: devices.statusId, // 🌟 Забираем текущий ID статуса (брак/неисправен)
        })
        .from(devices)
        .where(inArray(devices.id, deviceIds));

      logsToRecord = devicesData;

      // Находим системный ID статуса «в ремонте»
      const [repairStatusRow] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.name, 'в ремонте'));

      if (!repairStatusRow) {
        throw new Error(
          'Системный статус "в ремонте" не найден в справочнике. Обратитесь к администратору.'
        );
      }

      // 3. Чистим старые связи-черновики РЕМОНТНЫХ партий (если прибор перекидывают из ведомости в ведомость)
      const repairDraftBatches = await tx
        .select({ id: verificationBatches.id })
        .from(verificationBatches)
        .where(
          and(
            eq(verificationBatches.status, 'draft'),
            eq(verificationBatches.type, 'repair')
          )
        );

      const repairDraftBatchIds = repairDraftBatches.map((b) => b.id);

      if (repairDraftBatchIds.length > 0) {
        await tx
          .delete(devicesToBatches)
          .where(
            and(
              inArray(devicesToBatches.deviceId, deviceIds),
              inArray(devicesToBatches.batchId, repairDraftBatchIds)
            )
          );
      }

      // 4. Массово вставляем связи и сохраняем предысторию поломки прибора
      const linksToInsert = devicesData.map((dev) => ({
        batchId: batchId,
        deviceId: dev.id,
        deviceStatus: 'in_repair', // 🌟 Статус внутри ремонтной партии
        previousStatusId: dev.statusId, // 🌟 ЗАПОМИНАЕМ: прибор ушел в ремонт из статуса «забракован» или «неисправен»
      }));

      await tx.insert(devicesToBatches).values(linksToInsert);

      // 5. Массово переводим приборы в статус «в ремонте»
      await tx
        .update(devices)
        .set({
          statusId: repairStatusRow.id,
          updatedAt: now,
        })
        .where(inArray(devices.id, deviceIds));

      // 6. Массово пинаем наш обновленный кэш для каждого прибора.
      // Кэш увидит статус "в ремонте" + блокировку брака, занулит даты и оставит оранжевый чип!
      if (this.deviceService) {
        for (const dId of deviceIds) {
          await this.deviceService.updateMetrologyCache(tx, dId);
        }
      }
    });

    // 7. ЗАПИСЬ В ЖУРНАЛ АУДИТА
    // if (this.auditLogService && logsToRecord.length > 0) {
    //   await Promise.all(
    //     logsToRecord.map((logItem) =>
    //       this.auditLogService!.logAction({
    //         deviceId: logItem.id,
    //         action: 'assign_repair_batch', // Кастомный экшен для ремонтов
    //         newData: {
    //           batchId,
    //           batchNumber: recordedBatchNumber,
    //           name: logItem.name,
    //           model: logItem.model,
    //           serialNumber: logItem.serialNumber,
    //         },
    //         userId,
    //       })
    //     )
    //   );
    // }

    return true;
  }

  async removeDevicesFromRepairBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    let logsToRecord: any[] = [];
    let isBatchDeleted = false;
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // 1. Проверяем существование ремонтной партии
      const [targetBatch] = await tx
        .select({ status: verificationBatches.status })
        .from(verificationBatches)
        .where(
          and(
            eq(verificationBatches.id, batchId),
            eq(verificationBatches.type, 'repair')
          )
        )
        .limit(1);

      if (!targetBatch) {
        throw new Error('Ремонтная ведомость не найдена в системе.');
      }

      const devicesData = await tx
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
        })
        .from(devices)
        .where(inArray(devices.id, deviceIds));

      logsToRecord = devicesData;

      // Получаем дефолтный статус поломки на случай, если снимок стерся
      const [statusBroken] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.name, 'неисправен'))
        .limit(1);

      // 2. ОТКАТ СТАТУСОВ: Возвращаем приборам исходный вид брака, который был до ремонта
      for (const deviceId of deviceIds) {
        const [savedLink] = await tx
          .select({ previousStatusId: devicesToBatches.previousStatusId })
          .from(devicesToBatches)
          .where(
            and(
              eq(devicesToBatches.batchId, batchId),
              eq(devicesToBatches.deviceId, deviceId)
            )
          )
          .limit(1);

        // Восстанавливаем статус (например, "забракован"), который был до оранжевого чипа ремонта
        const targetStatusId = savedLink?.previousStatusId || statusBroken?.id;

        if (targetStatusId) {
          await tx
            .update(devices)
            .set({ statusId: targetStatusId, updatedAt: now })
            .where(eq(devices.id, deviceId));
        }

        // Пересчитываем кэш, чтобы вернуть даты в исходное состояние
      }

      // 3. Удаляем связь с ремонтной партией
      await tx
        .delete(devicesToBatches)
        .where(
          and(
            eq(devicesToBatches.batchId, batchId),
            inArray(devicesToBatches.deviceId, deviceIds)
          )
        );

      // 4. ПРОВЕРКА НА ПУСТОТУ: Если накладная опустела — уничтожаем её
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(devicesToBatches)
        .where(eq(devicesToBatches.batchId, batchId));

      if (!remaining || remaining.count === 0) {
        await tx
          .delete(verificationBatches)
          .where(eq(verificationBatches.id, batchId));

        isBatchDeleted = true;
      }
    });

    if (this.deviceService) {
      for (const deviceId of deviceIds) {
        // Вызываем метод кэширования, передавая стандартный db инстанс
        await this.deviceService.updateMetrologyCache(this.db, deviceId);
      }
    }

    // 5. ЗАПИСЬ В ЖУРНАЛ АУДИТА (Вне транзакции)
    // if (this.auditLogService && logsToRecord.length > 0) {
    //   await Promise.all(
    //     logsToRecord.map((logItem) =>
    //       this.auditLogService!.logAction({
    //         deviceId: logItem.id,
    //         action: 'remove_repair_batch',
    //         oldData: {
    //           batchId,
    //           isBatchDeleted,
    //           name: logItem.name,
    //           model: logItem.model,
    //           serialNumber: logItem.serialNumber,
    //         },
    //         userId,
    //       })
    //     )
    //   );
    // }

    return true;
  }

  async updateRepairBatchStatus(
    id: string,
    status: 'draft' | 'sent' | 'completed'
  ) {
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      // Проверяем существование именно ремонтного батча
      const [currentBatch] = await tx
        .select()
        .from(verificationBatches)
        .where(
          and(
            eq(verificationBatches.id, id),
            eq(verificationBatches.type, 'repair')
          )
        )
        .limit(1);

      if (!currentBatch) {
        throw new Error(
          'Ремонтная ведомость для обновления статуса не найдена'
        );
      }

      // Обновляем статус ведомости
      const [updatedBatch] = await tx
        .update(verificationBatches)
        .set({
          status,
          updatedAt: now,
        })
        .where(eq(verificationBatches.id, id))
        .returning();

      // Для ремонтов при смене статуса накладной на 'sent' приборы уже находятся в мастерской (в ремонте),
      // поэтому тяжелых вложенных циклов обновлений статусов СИ здесь не требуется.
      return updatedBatch;
    });
  }

  async getRepairDevices(args: {
    limit: number;
    offset: number;
    filter?: any;
  }) {
    const { limit = 25, offset = 0, filter } = args;
    const conditions = [];

    // 1. Ищем ID проблемных статусов в базе данных
    const repairStatuses = await this.db
      .select({ id: statuses.id })
      .from(statuses)
      .where(
        inArray(sql`lower(trim(${statuses.name}))`, [
          'неисправен',
          'забракован',
          'в ремонте',
        ])
      );

    const repairStatusIds = repairStatuses.map((s: any) => s.id);

    // Если в базе вообще нет таких статусов (справочник пуст), возвращаем пустой массив
    if (repairStatusIds.length === 0) {
      return { items: [], totalCount: 0 };
    }

    // 2. ЖЕСТКОЕ УСЛОВИЕ: вытаскиваем только приборы с дефектами или в ремонте
    conditions.push(inArray(devices.statusId, repairStatusIds));

    // Текстовые фильтры из строки поиска Журнала ремонта
    if (filter?.deviceName) {
      conditions.push(ilike(devices.name, `%${filter.deviceName}%`));
    }
    if (filter?.serialNumber) {
      conditions.push(ilike(devices.serialNumber, `%${filter.serialNumber}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 3. Подсчет общего количества дефектных приборов для пагинации на клиенте
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(whereClause);

    // 4. Запрос плоского списка приборов с джоинами локаций
    const items = await this.db.query.devices.findMany({
      where: whereClause,
      limit,
      offset,
      orderBy: (d: any, { desc }: any) => [desc(d.updatedAt)],
      columns: {
        id: true,
        name: true,
        model: true,
        grsiNumber: true,
        serialNumber: true,
        inventoryNumber: true,
        cachedControl: true,
        nextVerificationDate: true,
        nextInspectionDate: true,
      },
      with: {
        status: { columns: { name: true } },
        verifications: {
          where: (v: any, { eq }: any) => eq(v.result, 'не годен'),
          orderBy: (v: any, { desc }: any) => [desc(v.date)],
          limit: 1, // Берем строго самый свежий документ поломки
        },
        devicesToBatches: {
          with: {
            batch: {
              columns: {
                id: true,
                status: true,
                type: true,
              },
            },
          },
        },

        productionSite: {
          columns: { name: true },
          with: {
            city: { columns: { name: true } },
            company: { columns: { name: true } },
          },
        },
      },
    });

    // Формируем структуру ответа, которая строго соответствует нашей GraphQL-схеме PlanningPoolResponse
    return {
      items: items.map((d: any) => {
        // 1. Ищем живую связь прибора с активным ремонтом в БД
        const activeRepairLink = d.devicesToBatches?.find(
          (rel: any) =>
            rel.batch?.type === 'repair' &&
            (rel.batch?.status === 'draft' || rel.batch?.status === 'sent')
        );

        //  2. АКТИВИРУЕМ: Извлекаем фактический текстовый статус прибора из БД
        const currentStatusName = d.status?.name?.trim().toLowerCase() || '';

        // 3. СВЕРХНАДЁЖНЫЙ ФЛАГ ЗАНЯТОСТИ:
        // Прибор считается заблокированным ТОЛЬКО если у него есть активный линк
        // И при этом его глобальный статус в системе равен "в ремонте"!
        const isAssigned =
          !!activeRepairLink && currentStatusName === 'в ремонте';

        const lastBadVerification = d.verifications?.[0];
        const actualDefectDate = lastBadVerification?.date
          ? new Date(lastBadVerification.date).toISOString()
          : d.createdAt
          ? new Date(d.createdAt).toISOString()
          : new Date().toISOString();

        return {
          id: d.id,
          name: d.name,
          model: d.model,
          serialNumber: d.serialNumber,
          validUntil: actualDefectDate,
          lastControlDate: lastBadVerification?.date
            ? new Date(lastBadVerification.date).toISOString().slice(0, 10)
            : null,
          suggestedMonth: '0000-00',

          // Теперь, если статус сбросился в "неисправен", targetBatchId жестко станет null, и чекбокс оживет!
          targetBatchId: isAssigned ? activeRepairLink.batchId : null,
          isManualPlacement: isAssigned,

          controlType: d.cachedControl || 'контроль',
          isOverdue: false,
          scheduleStatus: 'active',
        };
      }),
      totalCount: countResult?.count ?? 0,
    };
  }

  async bulkScrapDevices(
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;
    const now = new Date();

    await this.db.transaction(async (tx) => {
      // 1. Ищем ID статуса "списан" в БД (устойчиво к любому регистру: Списан / списан)
      const [statusScrapped] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(sql`lower(trim(${statuses.name})) = 'списан'`)
        .limit(1);

      if (!statusScrapped) {
        throw new Error(
          'Системный статус "списан" не найден в справочнике statuses.'
        );
      }

      // 2. МАССОВОЕ ОБНОВЛЕНИЕ: Переводим приборы в статус "списан"
      await tx
        .update(devices)
        .set({
          statusId: statusScrapped.id,
          updatedAt: now,
          updatedById: userId,
        })
        .where(inArray(devices.id, deviceIds));

      // 3. КАКАДНОЕ ОЧИЩЕНИЕ: Извлекаем приборы из всех активных черновиков (поверок, осмотров, ремонтов)
      // Чтобы они не висели мертвым грузом в открытых накладных
      await tx.delete(devicesToBatches).where(
        and(
          inArray(devicesToBatches.deviceId, deviceIds),
          inArray(
            devicesToBatches.batchId,
            tx
              .select({ id: verificationBatches.id })
              .from(verificationBatches)
              .where(inArray(verificationBatches.status, ['draft', 'sent']))
          )
        )
      );
    });

    // 4. ПЕРЕСЧЕТ КЭША: Зануляем плановые даты МПИ/ТО, так как приборы списаны
    if (this.deviceService) {
      for (const deviceId of deviceIds) {
        // Вызываем метод кэширования, передавая стандартный db инстанс
        await this.deviceService.updateMetrologyCache(this.db, deviceId);
      }
    }

    return true;
  }

  async getDeviceRepairHistory(deviceId: string) {
    // 1. Извлекаем все ремонтные ведомости прибора
    const repairLinks = await this.db.query.devicesToBatches.findMany({
      where: (dtb: any, { eq }: any) => eq(dtb.deviceId, deviceId),
      with: {
        batch: {
          with: {
            createdBy: { columns: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: (dtb: any, { desc }: any) => [desc(dtb.createdAt)],
    });

    // 🌟 ФИКС: Безопасно фильтруем строго ремонтный контур силами JavaScript
    const cleanRepairs = repairLinks.filter(
      (link: any) => link.batch && link.batch.type === 'repair'
    );

    if (cleanRepairs.length === 0) return [];

    // 2. Вытягиваем документы контроля, привязанные к этим ремонтным партиям
    const batchIds = cleanRepairs.map((link: any) => link.batchId);
    const linkedDocs = await this.db.query.verifications.findMany({
      where: (v: any, { and, eq, inArray }: any) =>
        and(eq(v.deviceId, deviceId), inArray(v.batchId, batchIds)),
      with: { metrologyControleType: { columns: { name: true } } },
    });

    const docsMap = new Map(linkedDocs.map((doc: any) => [doc.batchId, doc]));

    // // 3. Формируем чистый таймлайн ремонта для фронтенда
    // return cleanRepairs.map((link: any) => {
    //   const closingDoc = docsMap.get(link.batchId) as any;
    //   const docResultClean = closingDoc?.result?.trim().toLowerCase() || '';

    //   return {
    //     batchId: link.batchId,
    //     batchNumber: link.batch.number,
    //     dateIn: new Date(link.createdAt).toLocaleDateString('ru-RU'), // Дата поломки/приемки
    //     dateOut: closingDoc?.date
    //       ? new Date(closingDoc.date).toLocaleDateString('ru-RU')
    //       : 'В процессе',
    //     master: link.batch.createdBy
    //       ? `${
    //           link.batch.createdBy.lastName
    //         } ${link.batch.createdBy.firstName.slice(0, 1)}.`
    //       : '—',
    //     result: closingDoc
    //       ? docResultClean === 'годен'
    //         ? 'Исправен 🟢'
    //         : 'Брак 🔴'
    //       : 'В ремонте 🛠️',
    //     closingDocType: closingDoc?.metrologyControleType?.name || '—',
    //     comment: closingDoc?.comment || 'без примечаний',
    //   };

    const [dbDevice] = await this.db
      .select({
        statusName: statuses.name,
      })
      .from(devices)
      .leftJoin(statuses, eq(devices.statusId, statuses.id))
      .where(eq(devices.id, deviceId))
      .limit(1);

    // 3. 🌟 УМНЫЙ МАППИНГ: Учитываем статус списания для незакрытых ведомостей
    // Сначала достаем текущий текстовый статус самого прибора из объекта items, полученного на Шаге 1
    // (Подразумевается, что связь status.name у вас подтянута в d.status?.name)
    const currentDeviceStatus = dbDevice?.statusName
      ? dbDevice.statusName.trim().toLowerCase()
      : '';
    const isDeviceScrapped = currentDeviceStatus === 'списан';

    // return cleanRepairs.map((link: any) => {
    //   const closingDoc = docsMap.get(link.batchId) as any;
    //   const docResultClean = closingDoc?.result?.trim().toLowerCase() || '';

    //   let finalResult = 'В ремонте 🛠️';
    //   let finalDateOut = 'В процессе';
    //   let docTypeLabel = closingDoc?.metrologyControleType?.name || '—';
    //   let finalComment = closingDoc?.comment || 'Без примечаний';

    //   // 🌟 ИСТОРИЧЕСКИ ТОЧНЫЙ АЛГОРИТМ РАСПРЕДЕЛЕНИЯ СТАТУСОВ:
    //   if (closingDoc) {
    //     // КЕЙС 1: Ремонт ИЗ ПРОШЛОГО (или текущий) успешно закрыт документом.
    //     // Выводим чистую историю: Исправен или Брак. Текущий статус Списан сюда НЕ имеет права лезть!
    //     finalResult = docResultClean === 'годен' ? 'Исправен 🟢' : 'Брак 🔴';
    //     finalDateOut = new Date(closingDoc.date).toLocaleDateString('ru-RU');
    //   } else if (isDeviceScrapped) {
    //     // КЕЙС 2: 🌟 Документа нет, НО прибор сейчас списан!
    //     // Это значит, что данный конкретный (самый последний) ремонт прервался утилизацией СИ.
    //     finalResult = 'Списан ❌';
    //     finalDateOut = new Date().toLocaleDateString('ru-RU'); // День списания
    //     docTypeLabel = 'Акт списания';
    //     finalComment =
    //       'Прибор признан неремонтопригодным и выведен из эксплуатации';
    //   }

    //   return {
    //     batchId: link.batchId,
    //     batchNumber: link.batch.number,
    //     dateIn: new Date(link.createdAt).toLocaleDateString('ru-RU'),
    //     dateOut: finalDateOut,
    //     master: link.batch.createdBy
    //       ? `${
    //           link.batch.createdBy.lastName
    //         } ${link.batch.createdBy.firstName.slice(0, 1)}.`
    //       : '—',
    //     result: finalResult,
    //     closingDocType: docTypeLabel,
    //     comment: finalComment,
    //   };
    return cleanRepairs.map((link: any) => {
      const closingDoc = docsMap.get(link.batchId) as any;
      const docResultClean = closingDoc?.result?.trim().toLowerCase() || '';

      // 🌟 НАХОДИМ ТЕКУЩИЙ СТАТУС САМОЙ ВЕДОМОСТИ В БД ('draft' | 'sent' | 'completed')
      const batchStatus = link.batch?.status?.trim().toLowerCase() || '';

      let finalResult = 'В ремонте 🛠️';
      let finalDateOut = 'В процессе';
      let docTypeLabel = closingDoc?.metrologyControleType?.name || '—';
      let finalComment = closingDoc?.comment || 'Без примечаний';

      if (closingDoc) {
        // Кейс 1: Ремонт успешно закрыт официальным документом контроля
        finalResult = docResultClean === 'годен' ? 'Исправен 🟢' : 'Брак 🔴';
        finalDateOut = new Date(closingDoc.date).toLocaleDateString('ru-RU');
      } else if (
        isDeviceScrapped &&
        (batchStatus === 'draft' || batchStatus === 'sent')
      ) {
        // Кейс 2: 🌟 Списан может быть ТОЛЬКО активный ремонт, который шел прямо сейчас!
        finalResult = 'Списан ❌';
        finalDateOut = new Date().toLocaleDateString('ru-RU');
        docTypeLabel = 'Акт списания';
        finalComment = 'Прибор выведен из эксплуатации в процессе ремонта';
      } else if (batchStatus === 'completed') {
        // Кейс 3: 🌟 Ведомость закрыта в АРХИВ, но документ удален вручную.
        // Раз ведомость закрыта, но прибор не вышел исправным — значит, исторически это был БРАК!
        finalResult = 'Брак 🔴';
        finalDateOut = link.batch?.updatedAt
          ? new Date(link.batch.updatedAt).toLocaleDateString('ru-RU')
          : new Date().toLocaleDateString('ru-RU');
        docTypeLabel = 'Акт отбраковки';
        finalComment =
          'Документ контроля удален пользователем. Прибор зафиксирован в архиве как неисправный.';
      }

      return {
        batchId: link.batchId,
        batchNumber: link.batch.number,
        dateIn: new Date(link.createdAt).toLocaleDateString('ru-RU'),
        dateOut: finalDateOut,
        master: link.batch.createdBy
          ? `${
              link.batch.createdBy.lastName
            } ${link.batch.createdBy.firstName.slice(0, 1)}.`
          : '—',
        result: finalResult,
        closingDocType: docTypeLabel,
        comment: finalComment,
      };
    });
  }
}
