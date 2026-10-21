import {
  eq,
  sql,
  inArray,
  and,
  gte,
  lte,
  desc,
  notInArray,
  asc,
  ilike,
} from 'drizzle-orm';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices } from '../../device/models/device.model';

import { statuses } from '../../catalog/models/status.model';
import { DrizzleDB } from '../../../db/client';
import { VerificationPlanningService } from '../../verification/service/verification.service';
import {
  verifications,
  verificationBatches,
  devicesToBatches,
} from '../../verification/models/verification.model';
import { DeviceService } from '../../device/service/device.service';
import { DeviceAuditLogService } from '../../audit/auditLog.service';

export class InspectionService {
  constructor(
    private db: DrizzleDB,
    private planningService?: VerificationPlanningService,
    private auditLogService?: DeviceAuditLogService,
    private deviceService?: DeviceService
  ) {}

  async createBulkInspection(
    items: { deviceId: string; isSuccess: boolean; intervalMonths: number }[],
    userId: string
  ) {
    if (!items.length) return false;

    let devicesData: any[] = [];

    if (this.auditLogService) {
      const allIds = items.map((i) => i.deviceId);
      devicesData = await this.db
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
        })
        .from(devices)
        .where(inArray(devices.id, allIds));
    }

    let createdBatchNumber = '';
    let createdBatchId = '';

    await this.db.transaction(async (tx: any) => {
      // 1. ОПТИМИЗАЦИЯ СПРАВОЧНИКОВ: Прямой поиск по B-Tree индексу (в БД всё в нижнем регистре)
      const [inspectionType] = await tx
        .select({ id: metrologyControleTypes.id })
        .from(metrologyControleTypes)
        .where(eq(metrologyControleTypes.name, 'осмотр'))
        .limit(1);

      const [statusBroken] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.name, 'неисправен'))
        .limit(1);

      if (!inspectionType) {
        throw new Error('Тип контроля "Осмотр" не найден в справочнике!');
      }

      const now = new Date();
      // Вычисляем validUntilDate без смещения времени
      // const validUntilDate = new Date();
      // validUntilDate.setMonth(validUntilDate.getMonth() + intervalMonths);

      const year = now.getFullYear();
      const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
      const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

      // 2. Получаем номер последней партии за текущий год (тянем только нужную колонку)
      const [lastBatch] = await tx
        .select({ number: verificationBatches.number })
        .from(verificationBatches)
        .where(
          and(
            gte(verificationBatches.plannedDate, startOfYear),
            lte(verificationBatches.plannedDate, endOfYear),
            eq(verificationBatches.type, 'inspection')
          )
        )
        .orderBy(desc(verificationBatches.createdAt))
        .limit(1);

      let nextSequenceNumber = 1;
      if (lastBatch?.number) {
        const match = lastBatch.number.match(/\d+$/);
        if (match) {
          const lastSequence = parseInt(match[0], 10);
          if (!isNaN(lastSequence)) {
            nextSequenceNumber = lastSequence + 1;
          }
        }
      }
      const formattedSequence = String(nextSequenceNumber).padStart(3, '0');

      createdBatchNumber = `О-${year}/${formattedSequence}`;

      // 3. Создаем закрытую партию осмотра
      const [newBatch] = await tx
        .insert(verificationBatches)
        .values({
          number: createdBatchNumber,
          plannedDate: now,
          status: 'completed',
          type: 'inspection',
          comment: `Комплексный внутренний осмотр партии оборудования (${items.length} ед.).`,
          createdById: userId,
        })
        .returning({ id: verificationBatches.id });

      createdBatchId = newBatch.id;

      const verificationValues = [];
      const devicesToBatchesValues = [];
      const brokenDeviceIds: string[] = [];
      const successDeviceIds: string[] = [];
      const allDeviceIds: string[] = [];

      // Формируем массивы для массовой вставки (Батчинг работает идеально)
      for (const item of items) {
        allDeviceIds.push(item.deviceId);

        // Индивидуальный расчет дедлайна для каждого конкретного прибора
        let itemValidUntil: Date | null = null;

        if (item.isSuccess && item.intervalMonths > 0) {
          itemValidUntil = new Date();
          itemValidUntil.setMonth(
            itemValidUntil.getMonth() + item.intervalMonths
          );
        }

        verificationValues.push({
          deviceId: item.deviceId,
          date: now,
          validUntil: itemValidUntil,
          metrologyControleTypeId: inspectionType.id,
          result: item.isSuccess ? 'годен' : 'не годен',
          batchId: newBatch.id,
          comment: item.isSuccess
            ? `Плановый осмотр. Периодичность повтора: ${
                item.intervalMonths > 0
                  ? `${item.intervalMonths} мес.`
                  : 'Разово'
              }`
            : 'Выявлены дефекты при техническом осмотре',
        });

        devicesToBatchesValues.push({
          deviceId: item.deviceId,
          batchId: newBatch.id,
          deviceStatus: item.isSuccess ? 'returned' : 'dismantled',
        });

        if (item.isSuccess) successDeviceIds.push(item.deviceId);
        else brokenDeviceIds.push(item.deviceId);
      }

      // Массово вставляем документы и связи за 2 быстрых запроса
      await tx.insert(verifications).values(verificationValues);
      await tx.insert(devicesToBatches).values(devicesToBatchesValues);

      // 4. Массово обновляем статусы приборов
      if (brokenDeviceIds.length > 0 && statusBroken) {
        await tx
          .update(devices)
          .set({ statusId: statusBroken.id, updatedAt: now })
          .where(inArray(devices.id, brokenDeviceIds));
      }

      if (successDeviceIds.length > 0) {
        // Для успешных приборов статус не меняем, только обновляем дату изменения
        await tx
          .update(devices)
          .set({ updatedAt: now, updatedById: userId })
          .where(inArray(devices.id, successDeviceIds));
      }

      await Promise.all(
        allDeviceIds.map((deviceId) =>
          this.deviceService!.updateMetrologyCache(tx, deviceId)
        )
      );

      return true;
    });

    if (this.auditLogService && createdBatchId) {
      await this.auditLogService.logAction({
        action: 'inspection_batch_create',
        newData: {
          batchNumber: createdBatchNumber,
        },
        userId,
      });

      // 2. Параллельно записываем индивидуальные акты ТО для каждого прибора в их историю
      if (devicesData.length > 0) {
        await Promise.all(
          devicesData.map((deviceItem) => {
            const inputItem = items.find((i) => i.deviceId === deviceItem.id);
            const isSuccess = inputItem ? inputItem.isSuccess : true;

            return this.auditLogService!.logAction({
              deviceId: deviceItem.id,
              action: 'inspection_doc_save',
              newData: {
                batchNumber: createdBatchNumber,
                name: deviceItem.name,
                model: deviceItem.model,
                serialNumber: deviceItem.serialNumber,
                comment: isSuccess
                  ? 'Годен (успешный осмотр)'
                  : 'Не исправен (выявлен брак)',
              },
              userId,
            });
          })
        );
      }
    }

    return true;
  }

  async getInspectionBatchesArchive(
    limit: number,
    offset: number,
    year: number
  ) {
    if (!this.planningService) {
      throw new Error(
        'Сервис планирования (planningService) не инициализирован!'
      );
    }

    // 1. Извлекаем пагинированную страницу актов ТО через наше оптимизированное ядро
    const rawBatches = await this.planningService.getVerificationBatches(
      year,
      undefined, // status не передан (выводим все статусы в архиве)
      'inspection', // строго акты осмотра
      limit,
      offset
    );

    // 2. ОПТИМИЗАЦИЯ COUNT: Считаем общее количество актов ТО СТРОГО ЗА ВЫБРАННЫЙ ГОД
    // Генерируем временной диапазон года в точности как внутри getVerificationBatches
    const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
    const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationBatches)
      .where(
        and(
          eq(verificationBatches.type, 'inspection'),
          gte(verificationBatches.plannedDate, startDate),
          lte(verificationBatches.plannedDate, endDate)
        )
      );

    // 3. Быстрый и чистый маппинг (благодаря оптимизации ядра, массивы верификаций внутри уже отсечены)
    const items = rawBatches.map((batch: any) => ({
      id: batch.id,
      number: batch.number,
      // Безопасно преобразуем дату в ISO строку
      date:
        batch.plannedDate instanceof Date
          ? batch.plannedDate.toISOString()
          : new Date(batch.plannedDate).toISOString(),
      comment: batch.comment,
      createdBy: batch.createdBy,
      devicesToBatches: (batch.devicesToBatches ?? [])
        .filter((link: any) => !!link?.device)
        .map((link: any) => ({
          id: link.id,
          deviceStatus: link.deviceStatus,
          device: {
            id: link.device.id,
            name: link.device.name,
            model: link.device.model,
            serialNumber: link.device.serialNumber,
          },
        })),
    }));

    return {
      items,
      totalCount: countResult?.count ?? 0,
    };
  }

  async getInspectionCalendarSummary() {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Исключаемые мертвые статусы (в нижнем регистре)
    const excludedStatuses = [
      'длительное хранение',
      'утерян',
      'забракован',
      'неисправен',
      'списан',
    ];

    // Инициализируем карту для сводной статистики на 12 месяцев текущего года
    const summaryMap: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
    }

    // Выгребаем плоский список дат следующих осмотров активных приборов
    const activeInspectionDevices = await this.db
      .select({
        nextInspectionDate: devices.nextInspectionDate,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          inArray(devices.scheduleStatus, ['active', 'paused_verification']),
          sql`${devices.nextInspectionDate} IS NOT NULL`,
          notInArray(
            devices.statusId,
            this.db
              .select({ id: statuses.id })
              .from(statuses)
              .where(inArray(statuses.name, excludedStatuses))
          )
        )
      );

    // Считаем годовую статистику на стороне Node.js (безопасно для PGlite)
    for (const device of activeInspectionDevices) {
      const [dYear, dMonth, dDay] = device
        .nextInspectionDate!.split('-')
        .map(Number) as [number, number, number];
      const inspectDate = new Date(dYear, dMonth - 1, dDay);

      const inspectMonthKey = `${inspectDate.getFullYear()}-${String(
        inspectDate.getMonth() + 1
      ).padStart(2, '0')}`;

      const isOverdue = inspectDate < currentMonthStart;
      const finalMonth = isOverdue ? currentMonthKey : inspectMonthKey;

      if (summaryMap[finalMonth] !== undefined) {
        summaryMap[finalMonth]++;
      }
    }

    // Возвращаем чистый годовой массив для календаря
    return Object.entries(summaryMap).map(([month, count]) => ({
      month,
      autoCount: count,
      manualCount: 0,
    }));
  }

  async getInspectionPoolByMonth(
    targetMonth: string,
    limit = 20,
    offset = 0,
    filter?: any
  ) {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const excludedStatuses = [
      'длительное хранение',
      'утерян',
      'забракован',
      'неисправен',
      'списан',
    ];

    // 1. Быстро собираем ID приборов, которые по логике Варианта Б относятся к запрашиваемому месяцу
    const activeInspectionDevices = await this.db
      .select({
        id: devices.id,
        nextInspectionDate: devices.nextInspectionDate,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          inArray(devices.scheduleStatus, ['active', 'paused_verification']),
          // eq(devices.cachedControl, 'осмотр'),
          sql`${devices.nextInspectionDate} IS NOT NULL`,
          notInArray(
            devices.statusId,
            this.db
              .select({ id: statuses.id })
              .from(statuses)
              .where(inArray(statuses.name, excludedStatuses))
          )
        )
      );

    const targetDeviceIds: string[] = [];

    for (const device of activeInspectionDevices) {
      const [dYear, dMonth, dDay] = device
        .nextInspectionDate!.split('-')
        .map(Number) as [number, number, number];
      const inspectDate = new Date(dYear, dMonth - 1, dDay);

      const inspectMonthKey = `${inspectDate.getFullYear()}-${String(
        inspectDate.getMonth() + 1
      ).padStart(2, '0')}`;
      const isOverdue = inspectDate < currentMonthStart;
      const finalMonth = isOverdue ? currentMonthKey : inspectMonthKey;

      if (finalMonth === targetMonth) {
        targetDeviceIds.push(device.id);
      }
    }

    const totalCount = targetDeviceIds.length;

    if (totalCount === 0) {
      return { items: [], totalCount: 0 };
    }

    const conditions = [inArray(devices.id, targetDeviceIds)];

    if (filter?.serialNumber) {
      conditions.push(ilike(devices.serialNumber, `%${filter.serialNumber}%`));
    }

    // 2. Получаем данные СТРОГО для текущей страницы (limit/offset)
    const pageDevices = await this.db.query.devices.findMany({
      where: and(...conditions),
      limit,
      offset,
      orderBy: (d) => [asc(d.nextInspectionDate)],
      columns: {
        id: true,
        name: true,
        model: true,
        serialNumber: true,
        nextInspectionDate: true,
        cachedControl: true,
      },
      with: {
        verifications: {
          orderBy: (v, { desc }) => [desc(v.date)],
          limit: 10,
          with: { metrologyControleType: true },
        },
      },
    });

    // 3. Формируем легкий плоский маппинг из 20 записей
    const items = pageDevices.map((device) => {
      // const latestInspection = device.verifications?.[0] || null;

      const latestInspection =
        device.verifications?.find(
          (v) =>
            v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
        ) || null;

      const [dYear, dMonth, dDay] = device
        .nextInspectionDate!.split('-')
        .map(Number) as [number, number, number];
      const inspectDate = new Date(dYear, dMonth - 1, dDay);
      const isOverdue = inspectDate < currentMonthStart;

      const displayControlType =
        device.cachedControl === 'осмотр'
          ? 'Обязательный осмотр'
          : 'Внутренний осмотр СИ/СК';

      return {
        id: device.id,
        name: device.name,
        model: device.model,
        serialNumber: device.serialNumber,
        lastInspectionDate: latestInspection?.date
          ? latestInspection.date.toISOString()
          : null,
        validUntil: inspectDate.toISOString(),
        isOverdue,
        controlType: displayControlType,
      };
    });

    return {
      items,
      totalCount,
    };
  }
}
