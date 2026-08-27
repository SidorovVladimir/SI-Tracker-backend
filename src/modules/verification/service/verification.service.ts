import { DrizzleDB } from '../../../db/client'; // Замените на ваш путь к инстансу базы данных
import { DeviceAuditLogService } from '../../audit/auditLog.service';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices } from '../../device/models/device.model';
import { eq, and, inArray, sql, gte, lte, desc } from 'drizzle-orm';
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

  // 2. Добавить приборы в партию
  async addDevicesToBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    const logsToRecord: any[] = [];
    let recordedBatchNumber = '';

    await this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(verificationBatches)
        .where(eq(verificationBatches.id, batchId));

      if (!batch) {
        throw new Error('Указанная партия поверок не найдена');
      }
      if (batch.status !== 'draft')
        throw new Error(
          'Нельзя добавлять приборы в отправленную/закрытую партию'
        );

      recordedBatchNumber = batch.number;

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

      for (const dId of deviceIds) {
        const [device] = await tx
          .select()
          .from(devices)
          .where(eq(devices.id, dId));
        if (device) {
          logsToRecord.push({
            deviceId: dId,
            name: device.name,
            model: device.model,
            serialNumber: device.serialNumber,
          });
        }
      }
    });
    if (this.auditLogService && logsToRecord.length > 0) {
      for (const logItem of logsToRecord) {
        await this.auditLogService.logAction({
          deviceId: logItem.deviceId,
          action: 'assign_batch',
          newData: {
            batchId,
            batchNumber: recordedBatchNumber,
            name: logItem.name,
            model: logItem.model,
            serialNumber: logItem.serialNumber,
          },
          userId,
        });
      }
    }

    return true;
  }

  // 3. Удалить приборы из партии (Вернуть их обратно в автоматический пул)
  // async removeDevicesFromBatch(
  //   batchId: string,
  //   deviceIds: string[],
  //   userId: string
  // ): Promise<boolean> {
  //   if (deviceIds.length === 0) return true;

  //   const logsToRecord: any[] = [];

  //   for (const dId of deviceIds) {
  //     const [device] = await this.db
  //       .select()
  //       .from(devices)
  //       .where(eq(devices.id, dId));

  //     if (device) {
  //       logsToRecord.push({
  //         deviceId: dId,
  //         name: device.name,
  //         model: device.model,
  //         serialNumber: device.serialNumber,
  //       });
  //     }
  //   }

  //   await this.db
  //     .delete(devicesToBatches)
  //     .where(
  //       and(
  //         eq(devicesToBatches.batchId, batchId),
  //         inArray(devicesToBatches.deviceId, deviceIds)
  //       )
  //     );

  //   if (this.auditLogService && logsToRecord.length > 0) {
  //     for (const logItem of logsToRecord) {
  //       await this.auditLogService.logAction({
  //         deviceId: logItem.deviceId,
  //         action: 'remove_batch',
  //         oldData: {
  //           name: logItem.name,
  //           model: logItem.model,
  //           serialNumber: logItem.serialNumber,
  //         },
  //         userId,
  //       });
  //     }
  //   }

  //   return true;
  // }

  async removeDevicesFromBatch(
    batchId: string,
    deviceIds: string[],
    userId: string
  ): Promise<boolean> {
    if (deviceIds.length === 0) return true;

    // Орачиваем в транзакцию, чтобы гарантировать целостность данных
    return await this.db.transaction(async (tx) => {
      const logsToRecord: any[] = [];

      // Используем 'tx' вместо 'this.db' для всех запросов внутри
      for (const dId of deviceIds) {
        const [device] = await tx
          .select()
          .from(devices)
          .where(eq(devices.id, dId));

        if (device) {
          logsToRecord.push({
            deviceId: dId,
            name: device.name,
            model: device.model,
            serialNumber: device.serialNumber,
          });
        }
      }

      // 1. Исключаем выбранные приборы из партии
      await tx
        .delete(devicesToBatches)
        .where(
          and(
            eq(devicesToBatches.batchId, batchId),
            inArray(devicesToBatches.deviceId, deviceIds)
          )
        );

      // 2. 🎯 ПРОВЕРКА НА ПУСТОТУ: Считаем, сколько приборов ОСТАЛОСЬ в этой партии
      const [remaining] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(devicesToBatches)
        .where(eq(devicesToBatches.batchId, batchId));

      // 3. Если в партии осталось 0 приборов — полностью удаляем саму партию
      if (!remaining || remaining.count === 0) {
        await tx
          .delete(verificationBatches)
          .where(eq(verificationBatches.id, batchId));
      }

      // Логирование аудита (работает внутри транзакции)
      if (this.auditLogService && logsToRecord.length > 0) {
        for (const logItem of logsToRecord) {
          await this.auditLogService.logAction({
            deviceId: logItem.deviceId,
            action: 'remove_batch',
            oldData: {
              name: logItem.name,
              model: logItem.model,
              serialNumber: logItem.serialNumber,
            },
            userId,
          });
        }
      }

      return true;
    });
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

  // private calculateNextVerificationDate(device: any): Date {
  //   const latestVerification = device.verifications?.[0];

  //   // Вариант 1: Есть прошлая поверка с датой окончания
  //   if (latestVerification?.validUntil) {
  //     return new Date(latestVerification.validUntil);
  //   }

  //   // Вариант 2: Прибор новый — считаем от даты выпуска/получения + МПИ в месяцах
  //   const baseDate = device.releaseDate || device.receiptDate;
  //   if (baseDate && device.verificationInterval) {
  //     const nextDate = new Date(baseDate);
  //     nextDate.setMonth(nextDate.getMonth() + device.verificationInterval);
  //     return nextDate;
  //   }

  //   // Вариант 3: Данных нет совсем — выталкиваем на текущую дату, чтобы метролог заметил прибор
  //   return new Date();
  // }

  // private calculateNextVerificationDate(device: any): Date {
  //   // Ищем последний легальный контроль (НЕ осмотр)
  //   const latestVerification = device.verifications?.find(
  //     (v: any) =>
  //       v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
  //   );

  //   // Вариант 1: Есть прошлая поверка с датой окончания
  //   if (latestVerification?.validUntil) {
  //     return new Date(latestVerification.validUntil);
  //   }

  //   // Вариант 2: Прибор новый — считаем от даты выпуска/получения + МПИ в месяцах
  //   const baseDate = device.releaseDate || device.receiptDate;
  //   if (baseDate && device.verificationInterval) {
  //     const nextDate = new Date(baseDate);
  //     nextDate.setMonth(nextDate.getMonth() + device.verificationInterval);
  //     return nextDate;
  //   }

  //   // Вариант 3: Данных нет совсем
  //   return new Date();
  // }

  private calculateNextVerificationDate(
    device: any,
    targetControlName: string
  ): Date | null {
    // 🎯 ИСПРАВЛЕНО: Ищем в истории документ СТРОГО вычисленного вида контроля

    const latestVerification = device.verifications?.find(
      (v: any) =>
        v.metrologyControleType?.name?.toLowerCase().trim() ===
        targetControlName
    );

    // Вариант 1: Есть прошлая запись именно этого контроля с датой окончания
    if (latestVerification?.validUntil) {
      return new Date(latestVerification.validUntil);
    }

    // Вариант 2: Прибор новый — считаем от даты выпуска/получения + МПИ в месяцах
    const baseDate = device.releaseDate || device.receiptDate;
    if (baseDate && device.verificationInterval) {
      console.log('hello newDevice');
      const nextDate = new Date(baseDate);
      nextDate.setMonth(nextDate.getMonth() + device.verificationInterval);
      return nextDate;
    }

    // Вариант 3: Данных нет совсем
    // Возвращаем null или текущую дату.
    // Лучше возвращать null, чтобы планировщик не пихал "пустые" приборы в текущий месяц без ведома метролога
    // return new Date();
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    return currentMonthStart;
  }

  // 5. ПОЛУЧИТЬ ПУЛ ПРИБОРОВ НА ВЫБРАННЫЙ МЕСЯЦ
  async getPlanningPoolByMonth(
    targetMonth: string,
    companyDefaultLeadTime = 30,
    limit = 20, // По умолчанию 20 приборов на страницу
    offset = 0, // По умолчанию первая страница (пропуск 0)
    controlTypeId?: string
  ) {
    const now = new Date();
    // Генерируем строковый ключ текущего реального месяца (например, "2026-06")
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

    const allDevices = await this.db.query.devices.findMany({
      where: eq(devices.archived, false),
      columns: {
        id: true,
        name: true,
        model: true,
        serialNumber: true,
        releaseDate: true,
        grsiNumber: true,
        receiptDate: true,
        verificationInterval: true,
        leadTimeDays: true,
      },
      with: {
        status: {
          columns: { name: true },
        },
        devicesToBatches: { with: { batch: true } },
        equipmentType: { columns: { name: true } },
        scopesToDevices: {
          with: { scope: { columns: { name: true } } },
        },
        verifications: {
          orderBy: (v, { desc }) => [desc(v.date), desc(v.createdAt)],
          limit: 5,
          with: { metrologyControleType: { columns: { name: true } } },
        },
      },
    });

    const pool: PlanningPoolItem[] = [];

    for (const device of allDevices) {
      const statusName = device.status?.name?.toLowerCase().trim() ?? '';
      // if (
      //   statusName === 'длительное хранение' ||
      //   statusName === 'неисправен' ||
      //   statusName === 'забракован' ||
      //   statusName === 'утерян' ||
      //   statusName === 'не годен'
      // ) {
      //   continue;
      // }
      if (
        [
          'длительное хранение',
          'неисправен',
          'забракован',
          'утерян',
          'не годен',
        ].includes(statusName)
      ) {
        continue;
      }

      const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
      const grsiNumber = device.grsiNumber;
      const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';
      const deviceScopes =
        device.scopesToDevices?.map((s: any) =>
          s.scope?.name?.toLowerCase().trim()
        ) ?? [];

      const isNotGr =
        deviceScopes.includes('не гр') ||
        deviceScopes.includes(
          'вне сферы государственного регулирования (не гр)'
        );

      // // ЖЕЛЕЗНОЕ ПРАВИЛО: Индикаторы, ВО и СИ вне сферы госрегулирования ("не ГР") вообще не идут в планировщик партий!
      // if (
      //   isNotGr || // 1. Если стоит "не ГР" — ПРИНУДИТЕЛЬНО ИСКЛЮЧАЕМ (высший приоритет, тип не важен!)
      //   eqTypeName === 'индикатор' || // 2. Если это Индикатор — исключаем
      //   eqTypeName === 'вспомогательное оборудование (во)' || // 3. Если это ВО — исключаем
      //   eqTypeName === 'средство контроля (ск)'
      // ) {
      //   if (
      //     eqTypeName === 'средство контроля (ск)' &&
      //     deviceScopes.length > 0 &&
      //     !isNotGr
      //   ) {
      //   } else {
      //     continue; // Исключаем прибор из графиков поверок ЦСМ
      //   }
      // }
      let targetControlName = 'осмотр';

      if (
        eqTypeName === 'индикатор' ||
        eqTypeName === 'вспомогательное оборудование (во)'
      ) {
        targetControlName = 'осмотр';
      } else if (eqTypeName === 'средство измерений (си)') {
        targetControlName = hasGrsi && !isNotGr ? 'поверка' : 'осмотр';
      } else if (eqTypeName === 'средство контроля (ск)') {
        targetControlName = isNotGr
          ? 'осмотр'
          : hasGrsi
          ? 'поверка'
          : 'калибровка';
      } else if (eqTypeName === 'испытательное оборудование (ио)') {
        targetControlName = isNotGr ? 'осмотр' : 'аттестация';
      }

      // 🎯 2. ЖЕЛЕЗНОЕ ПРАВИЛО: Если целевой контроль — ОСМОТР, прибор принудительно
      // исключается из этого планировщика пула (поверок/калибровок), так как он идет в журнал осмотров
      if (targetControlName === 'осмотр') {
        continue;
      }

      const nextVerificationDate = this.calculateNextVerificationDate(
        device,
        targetControlName
      );

      if (!nextVerificationDate) continue;

      // const latestVerification = device.verifications?.find(
      //   (v: any) =>
      //     v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
      // );
      const latestVerification = device.verifications?.find(
        (v: any) =>
          v.metrologyControleType?.name?.toLowerCase().trim() ===
          targetControlName
      );

      // const latestVerification = device.verifications?.[0];

      // const currentControlType =
      //   latestVerification?.metrologyControleType?.name || 'не указан';

      let currentControlType = latestVerification?.metrologyControleType?.name;
      if (!currentControlType) {
        // currentControlType =
        //   eqTypeName === 'испытательное оборудование (ио)'
        //     ? 'аттестация'
        //     : 'поверка';
        currentControlType = targetControlName.toLowerCase();
      }

      const activeBatchLink = device.devicesToBatches?.find(
        (link) =>
          link.batch?.status === 'draft' || link.batch?.status === 'sent'
      );

      // --- СЦЕНАРИЙ А: ПРИБОР УЖЕ ЗАКРЕПЛЕН МЕТРОЛОГОМ ЗА ПАРТИЕЙ ---
      if (activeBatchLink && activeBatchLink.batch) {
        const batchDate = new Date(activeBatchLink.batch.plannedDate);
        const batchMonthKey = `${batchDate.getFullYear()}-${String(
          batchDate.getMonth() + 1
        ).padStart(2, '0')}`;

        // Прибор жестко отображается только в том месяце, на который создана партия
        if (batchMonthKey === targetMonth) {
          pool.push({
            id: device.id,
            name: device.name,
            model: device.model,
            serialNumber: device.serialNumber,
            validUntil: latestVerification?.validUntil
              ? new Date(latestVerification.validUntil).toISOString()
              : null,
            suggestedMonth: targetMonth,
            targetBatchId: activeBatchLink.batch.id,
            isManualPlacement: true,
            controlType: currentControlType,
            // isOverdue: nextVerificationDate < now, // Сравниваем с реальным концом поверки
            isOverdue: latestVerification?.validUntil
              ? new Date(latestVerification.validUntil) < now
              : false,
          });
        }
        continue;
      }

      // --- СЦЕНАРИЙ Б: АВТОМАТИЧЕСКИЙ РАСЧЕТ ПУЛА (Lead Time + Сбор долгов) ---
      const currentLeadTime = device.leadTimeDays ?? companyDefaultLeadTime;
      const plannedActionDate = new Date(nextVerificationDate);
      plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

      // Вычисляем "родной" плановый месяц отправки прибора по графику логистики
      const actionYear = plannedActionDate.getFullYear();
      const actionMonthStr = String(plannedActionDate.getMonth() + 1).padStart(
        2,
        '0'
      );
      const deviceAutoMonthKey = `${actionYear}-${actionMonthStr}`;

      // Проверяем, остался ли прибор в прошлом по графику логистики относительно ТЕКУЩЕГО реального месяца
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const isDeviceOverdueInPast = plannedActionDate < currentMonthStart;

      // КЛЮЧЕВОЕ ПРАВИЛО ВАРИАНТА Б:
      // Если прибор из прошлого (долг) — его место ТОЛЬКО в текущем месяце.
      // Если прибор в будущем — его место в его родном плановом месяце.
      const finalTargetMonthForDevice = isDeviceOverdueInPast
        ? currentMonthKey
        : deviceAutoMonthKey;

      // Выводим прибор в таблицу только если вычисленный целевой месяц совпал с открытым на экране!
      if (finalTargetMonthForDevice === targetMonth) {
        pool.push({
          id: device.id,
          name: device.name,
          model: device.model,
          serialNumber: device.serialNumber,
          validUntil: latestVerification?.validUntil
            ? new Date(latestVerification.validUntil).toISOString()
            : null,
          suggestedMonth: finalTargetMonthForDevice,
          targetBatchId: null,
          isManualPlacement: false,
          controlType: currentControlType,
          isOverdue: nextVerificationDate < now,
        });
      }
    }

    pool.sort((a, b) => {
      if (!a.validUntil) return 1;
      if (!b.validUntil) return -1;
      // return (
      //   new Date(a.validUntil).getTime() - new Date(b.validUntil).getTime()
      // );
      return a.validUntil.localeCompare(b.validUntil);
    });

    const typeCounts: Record<string, number> = {};
    let unassignedCount = 0;

    for (const item of pool) {
      const typeKey = item.controlType.toLowerCase().trim();
      if (!typeKey || typeKey === 'не указан') {
        unassignedCount++;
      } else {
        typeCounts[item.controlType] = (typeCounts[item.controlType] || 0) + 1;
      }
    }

    const formattedTypeCounts = Object.entries(typeCounts).map(
      ([name, count]) => ({
        typeName: name,
        count,
      })
    );

    let filteredPool = [...pool];

    if (controlTypeId && controlTypeId !== 'ALL') {
      if (controlTypeId === 'NOT_SPECIFIED') {
        filteredPool = pool.filter((item) => {
          const t = item.controlType.toLowerCase().trim();
          return !t || t === 'не указан';
        });
      } else {
        const [targetType] = await this.db
          .select()
          .from(metrologyControleTypes)
          .where(eq(metrologyControleTypes.id, controlTypeId));

        if (targetType) {
          filteredPool = pool.filter(
            (item) =>
              item.controlType.toLowerCase().trim() ===
              targetType.name.toLowerCase().trim()
          );
        } else {
          filteredPool = [];
        }
      }
    }
    const paginatedItems = filteredPool.slice(offset, offset + limit);
    return {
      items: paginatedItems,
      totalCount: filteredPool.length,
      meta: {
        unassignedCount,
        typeCounts: formattedTypeCounts,
      },
    };
  }

  // 6. ПОЛУЧИТЬ СВОДНУЮ СТАТИСТИКУ ЗА ГОД (Синхронизировано с Вариантом Б на 100%)
  async getYearlyCalendarSummary(year: number, companyDefaultLeadTime = 30) {
    const summary: Record<
      string,
      { month: string; autoCount: number; manualCount: number }
    > = {};

    for (let m = 1; m <= 12; m++) {
      const monthKey = `${year}-${String(m).padStart(2, '0')}`;
      summary[monthKey] = { month: monthKey, autoCount: 0, manualCount: 0 };
    }

    const now = new Date();
    // Текущий рабочий месяц в формате "YYYY-MM" (например, "2026-06")
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allDevices = await this.db.query.devices.findMany({
      where: eq(devices.archived, false),
      columns: {
        id: true,
        releaseDate: true,
        receiptDate: true,
        grsiNumber: true,
        verificationInterval: true,
        leadTimeDays: true,
      },

      with: {
        status: {
          columns: { name: true },
        },
        devicesToBatches: { with: { batch: true } },
        equipmentType: { columns: { name: true } },
        scopesToDevices: {
          with: { scope: { columns: { name: true } } },
        },
        verifications: {
          // orderBy: (v, { desc }) => [desc(v.date)],
          orderBy: (v, { desc }) => [desc(v.date), desc(v.createdAt)],
          limit: 5,
          with: { metrologyControleType: { columns: { name: true } } },
        },
      },
    });

    for (const device of allDevices) {
      const statusName = device.status?.name?.toLowerCase().trim() ?? '';
      // if (
      //   statusName === 'длительное хранение' ||
      //   statusName === 'неисправен' ||
      //   statusName === 'забракован' ||
      //   statusName === 'утерян' ||
      //   statusName === 'не годен'
      // ) {
      //   continue;
      // }
      if (
        [
          'длительное хранение',
          'неисправен',
          'забракован',
          'утерян',
          'не годен',
        ].includes(statusName)
      ) {
        continue;
      }

      const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
      const grsiNumber = device.grsiNumber;
      const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';
      const deviceScopes =
        device.scopesToDevices?.map((s: any) =>
          s.scope?.name?.toLowerCase().trim()
        ) ?? [];

      const isNotGr =
        deviceScopes.includes('не гр') ||
        deviceScopes.includes(
          'вне сферы государственного регулирования (не гр)'
        );

      // ЖЕЛЕЗНОЕ ПРАВИЛО: Индикаторы, ВО и СИ вне сферы госрегулирования ("не ГР") вообще не идут в планировщик партий!
      // if (
      //   isNotGr || // 1. Если стоит "не ГР" — ПРИНУДИТЕЛЬНО ИСКЛЮЧАЕМ (высший приоритет, тип не важен!)
      //   eqTypeName === 'индикатор' || // 2. Если это Индикатор — исключаем
      //   eqTypeName === 'вспомогательное оборудование (во)' || // 3. Если это ВО — исключаем
      //   eqTypeName === 'средство контроля (ск)'
      // ) {
      //   if (
      //     eqTypeName === 'средство контроля (ск)' &&
      //     deviceScopes.length > 0 &&
      //     !isNotGr
      //   ) {
      //   } else {
      //     continue; // Исключаем прибор из графиков поверок ЦСМ
      //   }
      // }

      let targetControlName = 'осмотр';

      if (
        eqTypeName === 'индикатор' ||
        eqTypeName === 'вспомогательное оборудование (во)'
      ) {
        targetControlName = 'осмотр';
      } else if (eqTypeName === 'средство измерений (си)') {
        targetControlName = hasGrsi && !isNotGr ? 'поверка' : 'осмотр';
      } else if (eqTypeName === 'средство контроля (ск)') {
        targetControlName = isNotGr
          ? 'осмотр'
          : hasGrsi
          ? 'поверка'
          : 'калибровка';
      } else if (eqTypeName === 'испытательное оборудование (ио)') {
        targetControlName = isNotGr ? 'осмотр' : 'аттестация';
      }

      // 🎯 2. ЖЕЛЕЗНОЕ ПРАВИЛО: Если контроль прибора — ОСМОТР,
      // исключаем его из графиков и календаря поверки ЦСМ, так как у него свой журнал
      if (targetControlName === 'осмотр') {
        continue;
      }

      const nextVerificationDate = this.calculateNextVerificationDate(
        device,
        targetControlName
      );

      if (!nextVerificationDate) continue;

      const activeBatchLink = device.devicesToBatches?.find(
        (link) =>
          link.batch?.status === 'draft' || link.batch?.status === 'sent'
      );

      // Сценарий А: Распределяем ручные партии
      if (activeBatchLink && activeBatchLink.batch) {
        const batchDate = new Date(activeBatchLink.batch.plannedDate);
        if (batchDate.getFullYear() === year) {
          const monthKey = `${year}-${String(batchDate.getMonth() + 1).padStart(
            2,
            '0'
          )}`;
          if (summary[monthKey]) summary[monthKey].manualCount++;
        }
        continue;
      }

      // Сценарий Б: Распределяем автоматический пул по правилу Варианта Б
      const currentLeadTime = device.leadTimeDays ?? companyDefaultLeadTime;
      const plannedActionDate = new Date(nextVerificationDate);
      plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

      const actionYear = plannedActionDate.getFullYear();
      const actionMonthStr = String(plannedActionDate.getMonth() + 1).padStart(
        2,
        '0'
      );
      const deviceAutoMonthKey = `${actionYear}-${actionMonthStr}`;

      const isDeviceOverdueInPast = plannedActionDate < currentMonthStart;
      const finalTargetMonthForDevice = isDeviceOverdueInPast
        ? currentMonthKey
        : deviceAutoMonthKey;

      // Приплюсовываем счетчик в вычисленный месяц (если этот месяц входит в текущий отображаемый год)
      if (summary[finalTargetMonthForDevice]) {
        summary[finalTargetMonthForDevice].autoCount++;
      }
    }

    return Object.values(summary);
  }

  // async getVerificationBatches() {
  //   return await this.db.query.verificationBatches.findMany({
  //     orderBy: (b, { desc }) => [desc(b.createdAt)],
  //     with: {
  //       devicesToBatches: {
  //         with: {
  //           device: {
  //             with: {
  //               verifications: {
  //                 where: (v, { eq }) => eq(v.batchId, v.batchId),
  //                 orderBy: (v, { desc }) => [desc(v.date)],
  //               },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });
  // }

  // async getVerificationBatches(year?: number, status?: string) {
  //   const constraints = [];

  //   // 1. Фильтр по статусу ('draft' | 'sent' | 'completed')
  //   if (status) {
  //     constraints.push(eq(verificationBatches.status, status));
  //   }

  //   // 2. Фильтр по году плановой даты отправки
  //   if (year) {
  //     constraints.push(
  //       sql`extract(year from ${verificationBatches.plannedDate}) = ${year}`
  //     );
  //   }

  //   return await this.db.query.verificationBatches.findMany({
  //     where: constraints.length > 0 ? and(...constraints) : undefined,
  //     orderBy: (b, { desc }) => [desc(b.plannedDate)], // Свежие по дате партии будут первыми
  //     with: {
  //       devicesToBatches: {
  //         with: {
  //           device: {
  //             columns: {
  //               id: true,
  //               name: true,
  //               model: true,
  //               serialNumber: true,
  //             },
  //             with: {
  //               verifications: {
  //                 where: (v, { eq }) => eq(v.batchId, v.batchId),
  //                 orderBy: (v, { desc }) => [desc(v.date)],
  //               },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });
  // }

  async getVerificationBatches(
    year?: number,
    status?: string,
    type?: 'verification' | 'inspection', // Наш чистый параметр
    limit?: number, // 🔥 Добавили необязательный лимит
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

    // 🔥 ИСПРАВЛЕНО: Прямая, надёжная фильтрация по системному полю типа партии
    const targetType = type ?? 'verification';
    constraints.push(eq(verificationBatches.type, targetType));

    return await this.db.query.verificationBatches.findMany({
      where: constraints.length > 0 ? and(...constraints) : undefined,
      orderBy: (b, { desc }) => [desc(b.plannedDate)],
      limit: limit, // 🔥 Передали в Drizzle (пропустит, если undefined)
      offset: offset, // 🔥 Передали в Drizzle (пропустит, если undefined)
      with: {
        createdBy: true,
        verificationOrganization: true,
        devicesToBatches: {
          with: {
            device: {
              columns: {
                id: true,
                name: true,
                model: true,
                serialNumber: true,
              },
              with: {
                verifications: {
                  orderBy: (v, { desc }) => [desc(v.date)],
                  limit: 1,
                },
                arshinBuffers: {
                  orderBy: (ab, { desc }) => [desc(ab.verificationDate)],
                },
              },
            },
          },
        },
      },
    });
  }
  // async getVerificationBatches(year?: number, status?: string) {
  //   const constraints = [];

  //   // 1. Фильтр по статусу партии
  //   if (status) {
  //     constraints.push(eq(verificationBatches.status, status));
  //   }

  //   // 2. Фильтр по году (оптимальный для индексов)
  //   if (year) {
  //     const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  //     const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

  //     constraints.push(
  //       and(
  //         gte(verificationBatches.plannedDate, startDate),
  //         lte(verificationBatches.plannedDate, endDate)
  //       )
  //     );
  //   }

  //   return await this.db.query.verificationBatches.findMany({
  //     where: constraints.length > 0 ? and(...constraints) : undefined,
  //     orderBy: (b, { desc }) => [desc(b.plannedDate)],
  //     with: {
  //       devicesToBatches: {
  //         with: {
  //           device: {
  //             columns: {
  //               id: true,
  //               name: true,
  //               model: true,
  //               serialNumber: true,
  //             },
  //             with: {
  //               verifications: {
  //                 orderBy: (v, { desc }) => [desc(v.date)],
  //               },
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });
  // }

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

    await this.db
      .delete(verificationBatches)
      .where(eq(verificationBatches.id, id));

    return true;
  }

  async getDraftBatchesByMonth(plannedMonth: string) {
    return await this.db
      .select({
        id: verificationBatches.id,
        number: verificationBatches.number,
      })
      .from(verificationBatches)
      .where(
        and(
          eq(verificationBatches.status, 'draft'),
          sql`to_char(${verificationBatches.plannedDate}, 'YYYY-MM') = ${plannedMonth}`
        )
      );
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
          .where(sql`lower(trim(${metrologyControleTypes.name})) = 'поверка'`)
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
          result: applicability ? 'Годен' : 'Не годен',
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
    // const newVerification = await this.db.transaction(async (tx) => {
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

    //   let targetStatusId = deviceExists.statusId; // По умолчанию статус оставляем прежним

    //   if (input.result === 'Не годен') {
    //     const [rejectedStatus] = await tx
    //       .select({ id: statuses.id })
    //       .from(statuses)
    //       .where(sql`lower(trim(${statuses.name})) IN ('забракован')`);

    //     if (rejectedStatus) {
    //       targetStatusId = rejectedStatus.id;
    //     }
    //   } else if (input.result === 'Годен') {
    //     const [activeStatus] = await tx
    //       .select({ id: statuses.id })
    //       .from(statuses)
    //       .where(eq(sql`lower(trim(${statuses.name}))`, 'исправен'));

    //     if (activeStatus) {
    //       targetStatusId = activeStatus.id;
    //     }
    //   }

    //   await tx
    //     .update(devices)
    //     .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
    //     .where(eq(devices.id, input.deviceId));

    //   logDeviceData = {
    //     name: deviceExists.name,
    //     model: deviceExists.model,
    //     serialNumber: deviceExists.serialNumber,
    //     cost: verificationRecord.cost ? parseFloat(verificationRecord.cost) : 0,
    //   };
    //   return verificationRecord;
    // });

    // let newDataSnapshot: any;
    // if (this.deviceService) {
    //   newDataSnapshot = await this.deviceService.getFlatAuditSnapshot(
    //     input.deviceId
    //   );
    // }

    // if (this.auditLogService && logDeviceData) {
    //   await this.auditLogService.logAction({
    //     deviceId: input.deviceId,
    //     action: 'verify',
    //     newData: {
    //       protocolNumber: input.protocolNumber,
    //       result: input.result,
    //       name: logDeviceData.name,
    //       model: logDeviceData.model,
    //       serialNumber: logDeviceData.serialNumber,
    //       cost: logDeviceData.cost,
    //     },
    //     userId,
    //   });
    //   if (oldDataSnapshot && newDataSnapshot) {
    //     await this.auditLogService.logAction({
    //       deviceId: input.deviceId,
    //       action: 'update',
    //       oldData: oldDataSnapshot,
    //       newData: newDataSnapshot,
    //       userId,
    //     });
    //   }
    // }

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

    const [verificationRecord] = await tx
      .insert(verifications)
      .values({
        deviceId: input.deviceId,
        batchId: input.batchId ?? null,
        protocolNumber: input.protocolNumber,
        result: input.result,
        date: input.date,
        validUntil: input.validUntil ?? null,
        documentUrl: input.documentUrl ?? null,
        metrologyControleTypeId: input.metrologyControleTypeId,
        verificationOrganizationId: input.verificationOrganizationId,
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

    let targetStatusId = deviceExists.statusId;

    if (input.result === 'Не годен') {
      const [rejectedStatus] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(sql`lower(trim(${statuses.name})) IN ('забракован')`);
      if (rejectedStatus) targetStatusId = rejectedStatus.id;
    } else if (input.result === 'Годен') {
      const [activeStatus] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(sql`lower(trim(${statuses.name}))`, 'исправен'));
      if (activeStatus) targetStatusId = activeStatus.id;
    }

    await tx
      .update(devices)
      .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
      .where(eq(devices.id, input.deviceId));

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
}
