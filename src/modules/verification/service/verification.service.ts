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

  // 2. Добавить приборы в партию
  // async addDevicesToBatch(
  //   batchId: string,
  //   deviceIds: string[],
  //   userId: string
  // ): Promise<boolean> {
  //   if (deviceIds.length === 0) return true;

  //   const logsToRecord: any[] = [];
  //   let recordedBatchNumber = '';

  //   await this.db.transaction(async (tx) => {
  //     const [batch] = await tx
  //       .select()
  //       .from(verificationBatches)
  //       .where(eq(verificationBatches.id, batchId));

  //     if (!batch) {
  //       throw new Error('Указанная партия поверок не найдена');
  //     }
  //     if (batch.status !== 'draft')
  //       throw new Error(
  //         'Нельзя добавлять приборы в отправленную/закрытую партию'
  //       );

  //     recordedBatchNumber = batch.number;

  //     // Если эти приборы уже были привязаны К ДРУГИМ ЧЕРНОВИКАМ партий,
  //     // мы удаляем старые связи, чтобы не плодить дубли
  //     await tx.delete(devicesToBatches).where(
  //       and(
  //         inArray(devicesToBatches.deviceId, deviceIds),
  //         // Проверяем через связь, что удаляем только из черновиков (для безопасности)
  //         inArray(
  //           devicesToBatches.batchId,
  //           tx
  //             .select({ id: verificationBatches.id })
  //             .from(verificationBatches)
  //             .where(eq(verificationBatches.status, 'draft'))
  //         )
  //       )
  //     );

  //     // Формируем массив новых связей
  //     const linksToInsert = deviceIds.map((dId) => ({
  //       batchId: batchId,
  //       deviceId: dId,
  //       deviceStatus: 'selected',
  //     }));

  //     // Массово вставляем приборы в новую партию
  //     await tx.insert(devicesToBatches).values(linksToInsert);

  //     for (const dId of deviceIds) {
  //       const [device] = await tx
  //         .select()
  //         .from(devices)
  //         .where(eq(devices.id, dId));
  //       if (device) {
  //         logsToRecord.push({
  //           deviceId: dId,
  //           name: device.name,
  //           model: device.model,
  //           serialNumber: device.serialNumber,
  //         });
  //       }
  //     }
  //   });
  //   if (this.auditLogService && logsToRecord.length > 0) {
  //     for (const logItem of logsToRecord) {
  //       await this.auditLogService.logAction({
  //         deviceId: logItem.deviceId,
  //         action: 'assign_batch',
  //         newData: {
  //           batchId,
  //           batchNumber: recordedBatchNumber,
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

  // async removeDevicesFromBatch(
  //   batchId: string,
  //   deviceIds: string[],
  //   userId: string
  // ): Promise<boolean> {
  //   if (deviceIds.length === 0) return true;

  //   // Орачиваем в транзакцию, чтобы гарантировать целостность данных
  //   return await this.db.transaction(async (tx) => {
  //     const logsToRecord: any[] = [];

  //     // Используем 'tx' вместо 'this.db' для всех запросов внутри
  //     for (const dId of deviceIds) {
  //       const [device] = await tx
  //         .select()
  //         .from(devices)
  //         .where(eq(devices.id, dId));

  //       if (device) {
  //         logsToRecord.push({
  //           deviceId: dId,
  //           name: device.name,
  //           model: device.model,
  //           serialNumber: device.serialNumber,
  //         });
  //       }
  //     }

  //     // 1. Исключаем выбранные приборы из партии
  //     await tx
  //       .delete(devicesToBatches)
  //       .where(
  //         and(
  //           eq(devicesToBatches.batchId, batchId),
  //           inArray(devicesToBatches.deviceId, deviceIds)
  //         )
  //       );

  //     // 2. 🎯 ПРОВЕРКА НА ПУСТОТУ: Считаем, сколько приборов ОСТАЛОСЬ в этой партии
  //     const [remaining] = await tx
  //       .select({ count: sql<number>`count(*)::int` })
  //       .from(devicesToBatches)
  //       .where(eq(devicesToBatches.batchId, batchId));

  //     // 3. Если в партии осталось 0 приборов — полностью удаляем саму партию
  //     if (!remaining || remaining.count === 0) {
  //       await tx
  //         .delete(verificationBatches)
  //         .where(eq(verificationBatches.id, batchId));
  //     }

  //     // Логирование аудита (работает внутри транзакции)
  //     if (this.auditLogService && logsToRecord.length > 0) {
  //       for (const logItem of logsToRecord) {
  //         await this.auditLogService.logAction({
  //           deviceId: logItem.deviceId,
  //           action: 'remove_batch',
  //           oldData: {
  //             name: logItem.name,
  //             model: logItem.model,
  //             serialNumber: logItem.serialNumber,
  //           },
  //           userId,
  //         });
  //       }
  //     }

  //     return true;
  //   });
  // }

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
      // ОПТИМИЗАЦИЯ 1: Вместо цикла из 500 запросов — делаем 1 МАССОВЫЙ SELECT для логов
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

      // 2. Исключаем выбранные приборы из партии одним запросом (Мгновенно по составному индексу)
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

  // private calculateNextVerificationDate(
  //   device: any,
  //   targetControlName: string
  // ): Date | null {
  //   // 🎯 ИСПРАВЛЕНО: Ищем в истории документ СТРОГО вычисленного вида контроля

  //   const latestVerification = device.verifications?.find(
  //     (v: any) =>
  //       v.metrologyControleType?.name?.toLowerCase().trim() ===
  //       targetControlName
  //   );

  //   // Вариант 1: Есть прошлая запись именно этого контроля с датой окончания
  //   if (latestVerification?.validUntil) {
  //     return new Date(latestVerification.validUntil);
  //   }

  //   // Вариант 2: Прибор новый — считаем от даты выпуска/получения + МПИ в месяцах
  //   const baseDate = device.releaseDate || device.receiptDate;
  //   if (baseDate && device.verificationInterval) {
  //     console.log('hello newDevice');
  //     const nextDate = new Date(baseDate);
  //     nextDate.setMonth(nextDate.getMonth() + device.verificationInterval);
  //     return nextDate;
  //   }

  //   // Вариант 3: Данных нет совсем
  //   // Возвращаем null или текущую дату.
  //   // Лучше возвращать null, чтобы планировщик не пихал "пустые" приборы в текущий месяц без ведома метролога
  //   // return new Date();
  //   const currentMonthStart = new Date();
  //   currentMonthStart.setDate(1);
  //   currentMonthStart.setHours(0, 0, 0, 0);

  //   return currentMonthStart;
  // }

  // 5. ПОЛУЧИТЬ ПУЛ ПРИБОРОВ НА ВЫБРАННЫЙ МЕСЯЦ
  // async getPlanningPoolByMonth(
  //   targetMonth: string,
  //   companyDefaultLeadTime = 30,
  //   limit = 20, // По умолчанию 20 приборов на страницу
  //   offset = 0, // По умолчанию первая страница (пропуск 0)
  //   controlTypeId?: string
  // ) {
  //   const now = new Date();
  //   // Генерируем строковый ключ текущего реального месяца (например, "2026-06")
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;

  //   const allDevices = await this.db.query.devices.findMany({
  //     where: eq(devices.archived, false),
  //     columns: {
  //       id: true,
  //       name: true,
  //       model: true,
  //       serialNumber: true,
  //       releaseDate: true,
  //       grsiNumber: true,
  //       receiptDate: true,
  //       verificationInterval: true,
  //       leadTimeDays: true,
  //     },
  //     with: {
  //       status: {
  //         columns: { name: true },
  //       },
  //       devicesToBatches: { with: { batch: true } },
  //       equipmentType: { columns: { name: true } },
  //       scopesToDevices: {
  //         with: { scope: { columns: { name: true } } },
  //       },
  //       verifications: {
  //         orderBy: (v, { desc }) => [desc(v.date), desc(v.createdAt)],
  //         limit: 5,
  //         with: { metrologyControleType: { columns: { name: true } } },
  //       },
  //     },
  //   });

  //   const pool: PlanningPoolItem[] = [];

  //   for (const device of allDevices) {
  //     const statusName = device.status?.name?.toLowerCase().trim() ?? '';
  //     if (
  //       [
  //         'длительное хранение',
  //         'неисправен',
  //         'забракован',
  //         'утерян',
  //         'не годен',
  //       ].includes(statusName)
  //     ) {
  //       continue;
  //     }

  //     const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
  //     const grsiNumber = device.grsiNumber;
  //     const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';
  //     const deviceScopes =
  //       device.scopesToDevices?.map((s: any) =>
  //         s.scope?.name?.toLowerCase().trim()
  //       ) ?? [];

  //     const isNotGr =
  //       deviceScopes.includes('не гр') ||
  //       deviceScopes.includes(
  //         'вне сферы государственного регулирования (не гр)'
  //       );

  //     let targetControlName = 'осмотр';

  //     if (
  //       eqTypeName === 'индикатор' ||
  //       eqTypeName === 'вспомогательное оборудование (во)'
  //     ) {
  //       targetControlName = 'осмотр';
  //     } else if (eqTypeName === 'средство измерений (си)') {
  //       targetControlName = hasGrsi && !isNotGr ? 'поверка' : 'осмотр';
  //     } else if (eqTypeName === 'средство контроля (ск)') {
  //       targetControlName = isNotGr
  //         ? 'осмотр'
  //         : hasGrsi
  //         ? 'поверка'
  //         : 'калибровка';
  //     } else if (eqTypeName === 'испытательное оборудование (ио)') {
  //       targetControlName = isNotGr ? 'осмотр' : 'аттестация';
  //     }

  //     // 🎯 2. ЖЕЛЕЗНОЕ ПРАВИЛО: Если целевой контроль — ОСМОТР, прибор принудительно
  //     // исключается из этого планировщика пула (поверок/калибровок), так как он идет в журнал осмотров
  //     if (targetControlName === 'осмотр') {
  //       continue;
  //     }

  //     const nextVerificationDate = this.calculateNextVerificationDate(
  //       device,
  //       targetControlName
  //     );

  //     if (!nextVerificationDate) continue;

  //     const latestVerification = device.verifications?.find(
  //       (v: any) =>
  //         v.metrologyControleType?.name?.toLowerCase().trim() ===
  //         targetControlName
  //     );

  //     let currentControlType = latestVerification?.metrologyControleType?.name;
  //     if (!currentControlType) {

  //       currentControlType = targetControlName.toLowerCase();
  //     }

  //     const activeBatchLink = device.devicesToBatches?.find(
  //       (link) =>
  //         link.batch?.status === 'draft' || link.batch?.status === 'sent'
  //     );

  //     // --- СЦЕНАРИЙ А: ПРИБОР УЖЕ ЗАКРЕПЛЕН МЕТРОЛОГОМ ЗА ПАРТИЕЙ ---
  //     if (activeBatchLink && activeBatchLink.batch) {
  //       const batchDate = new Date(activeBatchLink.batch.plannedDate);
  //       const batchMonthKey = `${batchDate.getFullYear()}-${String(
  //         batchDate.getMonth() + 1
  //       ).padStart(2, '0')}`;

  //       // Прибор жестко отображается только в том месяце, на который создана партия
  //       if (batchMonthKey === targetMonth) {
  //         pool.push({
  //           id: device.id,
  //           name: device.name,
  //           model: device.model,
  //           serialNumber: device.serialNumber,
  //           validUntil: latestVerification?.validUntil
  //             ? new Date(latestVerification.validUntil).toISOString()
  //             : null,
  //           suggestedMonth: targetMonth,
  //           targetBatchId: activeBatchLink.batch.id,
  //           isManualPlacement: true,
  //           controlType: currentControlType,
  //           // isOverdue: nextVerificationDate < now, // Сравниваем с реальным концом поверки
  //           isOverdue: latestVerification?.validUntil
  //             ? new Date(latestVerification.validUntil) < now
  //             : false,
  //         });
  //       }
  //       continue;
  //     }

  //     // --- СЦЕНАРИЙ Б: АВТОМАТИЧЕСКИЙ РАСЧЕТ ПУЛА (Lead Time + Сбор долгов) ---
  //     const currentLeadTime = device.leadTimeDays ?? companyDefaultLeadTime;
  //     const plannedActionDate = new Date(nextVerificationDate);
  //     plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

  //     // Вычисляем "родной" плановый месяц отправки прибора по графику логистики
  //     const actionYear = plannedActionDate.getFullYear();
  //     const actionMonthStr = String(plannedActionDate.getMonth() + 1).padStart(
  //       2,
  //       '0'
  //     );
  //     const deviceAutoMonthKey = `${actionYear}-${actionMonthStr}`;

  //     // Проверяем, остался ли прибор в прошлом по графику логистики относительно ТЕКУЩЕГО реального месяца
  //     const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  //     const isDeviceOverdueInPast = plannedActionDate < currentMonthStart;

  //     // КЛЮЧЕВОЕ ПРАВИЛО ВАРИАНТА Б:
  //     // Если прибор из прошлого (долг) — его место ТОЛЬКО в текущем месяце.
  //     // Если прибор в будущем — его место в его родном плановом месяце.
  //     const finalTargetMonthForDevice = isDeviceOverdueInPast
  //       ? currentMonthKey
  //       : deviceAutoMonthKey;

  //     // Выводим прибор в таблицу только если вычисленный целевой месяц совпал с открытым на экране!
  //     if (finalTargetMonthForDevice === targetMonth) {
  //       pool.push({
  //         id: device.id,
  //         name: device.name,
  //         model: device.model,
  //         serialNumber: device.serialNumber,
  //         validUntil: latestVerification?.validUntil
  //           ? new Date(latestVerification.validUntil).toISOString()
  //           : null,
  //         suggestedMonth: finalTargetMonthForDevice,
  //         targetBatchId: null,
  //         isManualPlacement: false,
  //         controlType: currentControlType,
  //         isOverdue: nextVerificationDate < now,
  //       });
  //     }
  //   }

  //   pool.sort((a, b) => {
  //     if (!a.validUntil) return 1;
  //     if (!b.validUntil) return -1;
  //     // return (
  //     //   new Date(a.validUntil).getTime() - new Date(b.validUntil).getTime()
  //     // );
  //     return a.validUntil.localeCompare(b.validUntil);
  //   });

  //   const typeCounts: Record<string, number> = {};
  //   let unassignedCount = 0;

  //   for (const item of pool) {
  //     const typeKey = item.controlType.toLowerCase().trim();
  //     if (!typeKey || typeKey === 'не указан') {
  //       unassignedCount++;
  //     } else {
  //       typeCounts[item.controlType] = (typeCounts[item.controlType] || 0) + 1;
  //     }
  //   }

  //   const formattedTypeCounts = Object.entries(typeCounts).map(
  //     ([name, count]) => ({
  //       typeName: name,
  //       count,
  //     })
  //   );

  //   let filteredPool = [...pool];

  //   if (controlTypeId && controlTypeId !== 'ALL') {
  //     if (controlTypeId === 'NOT_SPECIFIED') {
  //       filteredPool = pool.filter((item) => {
  //         const t = item.controlType.toLowerCase().trim();
  //         return !t || t === 'не указан';
  //       });
  //     } else {
  //       const [targetType] = await this.db
  //         .select()
  //         .from(metrologyControleTypes)
  //         .where(eq(metrologyControleTypes.id, controlTypeId));

  //       if (targetType) {
  //         filteredPool = pool.filter(
  //           (item) =>
  //             item.controlType.toLowerCase().trim() ===
  //             targetType.name.toLowerCase().trim()
  //         );
  //       } else {
  //         filteredPool = [];
  //       }
  //     }
  //   }
  //   const paginatedItems = filteredPool.slice(offset, offset + limit);
  //   return {
  //     items: paginatedItems,
  //     totalCount: filteredPool.length,
  //     meta: {
  //       unassignedCount,
  //       typeCounts: formattedTypeCounts,
  //     },
  //   };
  // }

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

  // 6. ПОЛУЧИТЬ СВОДНУЮ СТАТИСТИКУ ЗА ГОД (Синхронизировано с Вариантом Б на 100%)
  // async getYearlyCalendarSummary(year: number, companyDefaultLeadTime = 30) {
  //   const summary: Record<
  //     string,
  //     { month: string; autoCount: number; manualCount: number }
  //   > = {};

  //   for (let m = 1; m <= 12; m++) {
  //     const monthKey = `${year}-${String(m).padStart(2, '0')}`;
  //     summary[monthKey] = { month: monthKey, autoCount: 0, manualCount: 0 };
  //   }

  //   const now = new Date();
  //   // Текущий рабочий месяц в формате "YYYY-MM" (например, "2026-06")
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;
  //   const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  //   const allDevices = await this.db.query.devices.findMany({
  //     where: eq(devices.archived, false),
  //     columns: {
  //       id: true,
  //       releaseDate: true,
  //       receiptDate: true,
  //       grsiNumber: true,
  //       verificationInterval: true,
  //       leadTimeDays: true,
  //     },

  //     with: {
  //       status: {
  //         columns: { name: true },
  //       },
  //       devicesToBatches: { with: { batch: true } },
  //       equipmentType: { columns: { name: true } },
  //       scopesToDevices: {
  //         with: { scope: { columns: { name: true } } },
  //       },
  //       verifications: {
  //         // orderBy: (v, { desc }) => [desc(v.date)],
  //         orderBy: (v, { desc }) => [desc(v.date), desc(v.createdAt)],
  //         limit: 5,
  //         with: { metrologyControleType: { columns: { name: true } } },
  //       },
  //     },
  //   });

  //   for (const device of allDevices) {
  //     const statusName = device.status?.name?.toLowerCase().trim() ?? '';
  //          if (
  //       [
  //         'длительное хранение',
  //         'неисправен',
  //         'забракован',
  //         'утерян',
  //         'не годен',
  //       ].includes(statusName)
  //     ) {
  //       continue;
  //     }

  //     const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
  //     const grsiNumber = device.grsiNumber;
  //     const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';
  //     const deviceScopes =
  //       device.scopesToDevices?.map((s: any) =>
  //         s.scope?.name?.toLowerCase().trim()
  //       ) ?? [];

  //     const isNotGr =
  //       deviceScopes.includes('не гр') ||
  //       deviceScopes.includes(
  //         'вне сферы государственного регулирования (не гр)'
  //       );

  //     let targetControlName = 'осмотр';

  //     if (
  //       eqTypeName === 'индикатор' ||
  //       eqTypeName === 'вспомогательное оборудование (во)'
  //     ) {
  //       targetControlName = 'осмотр';
  //     } else if (eqTypeName === 'средство измерений (си)') {
  //       targetControlName = hasGrsi && !isNotGr ? 'поверка' : 'осмотр';
  //     } else if (eqTypeName === 'средство контроля (ск)') {
  //       targetControlName = isNotGr
  //         ? 'осмотр'
  //         : hasGrsi
  //         ? 'поверка'
  //         : 'калибровка';
  //     } else if (eqTypeName === 'испытательное оборудование (ио)') {
  //       targetControlName = isNotGr ? 'осмотр' : 'аттестация';
  //     }

  //     // 🎯 2. ЖЕЛЕЗНОЕ ПРАВИЛО: Если контроль прибора — ОСМОТР,
  //     // исключаем его из графиков и календаря поверки ЦСМ, так как у него свой журнал
  //     if (targetControlName === 'осмотр') {
  //       continue;
  //     }

  //     const nextVerificationDate = this.calculateNextVerificationDate(
  //       device,
  //       targetControlName
  //     );

  //     if (!nextVerificationDate) continue;

  //     const activeBatchLink = device.devicesToBatches?.find(
  //       (link) =>
  //         link.batch?.status === 'draft' || link.batch?.status === 'sent'
  //     );

  //     // Сценарий А: Распределяем ручные партии
  //     if (activeBatchLink && activeBatchLink.batch) {
  //       const batchDate = new Date(activeBatchLink.batch.plannedDate);
  //       if (batchDate.getFullYear() === year) {
  //         const monthKey = `${year}-${String(batchDate.getMonth() + 1).padStart(
  //           2,
  //           '0'
  //         )}`;
  //         if (summary[monthKey]) summary[monthKey].manualCount++;
  //       }
  //       continue;
  //     }

  //     // Сценарий Б: Распределяем автоматический пул по правилу Варианта Б
  //     const currentLeadTime = device.leadTimeDays ?? companyDefaultLeadTime;
  //     const plannedActionDate = new Date(nextVerificationDate);
  //     plannedActionDate.setDate(plannedActionDate.getDate() - currentLeadTime);

  //     const actionYear = plannedActionDate.getFullYear();
  //     const actionMonthStr = String(plannedActionDate.getMonth() + 1).padStart(
  //       2,
  //       '0'
  //     );
  //     const deviceAutoMonthKey = `${actionYear}-${actionMonthStr}`;

  //     const isDeviceOverdueInPast = plannedActionDate < currentMonthStart;
  //     const finalTargetMonthForDevice = isDeviceOverdueInPast
  //       ? currentMonthKey
  //       : deviceAutoMonthKey;

  //     // Приплюсовываем счетчик в вычисленный месяц (если этот месяц входит в текущий отображаемый год)
  //     if (summary[finalTargetMonthForDevice]) {
  //       summary[finalTargetMonthForDevice].autoCount++;
  //     }
  //   }

  //   return Object.values(summary);
  // }

  // async getYearlyCalendarSummary(year: number, companyDefaultLeadTime = 30) {
  //   const now = new Date();
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;
  //   const currentMonthStart = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}-01`;

  //   // Исключаемые статусы (гарантированно в нижнем регистре в БД)
  //   const excludedStatuses = [
  //     'длительное хранение',
  //     'неисправен',
  //     'забракован',
  //     'утерян',
  //     'не годен',
  //   ];

  //   // Инициализируем пустую структуру для 12 месяцев запрашиваемого года
  //   const summary: Record<
  //     string,
  //     { month: string; autoCount: number; manualCount: number }
  //   > = {};
  //   for (let m = 1; m <= 12; m++) {
  //     const monthKey = `${year}-${String(m).padStart(2, '0')}`;
  //     summary[monthKey] = { month: monthKey, autoCount: 0, manualCount: 0 };
  //   }

  //   // -------------------------------------------------------------------------
  //   // ВЫЧИСЛИТЕЛЬНЫЕ SQL-ВЫРАЖЕНИЯ (Переносим логику Варианта Б в базу)
  //   // -------------------------------------------------------------------------

  //   // Сценарий Б: Вычисляем дату отправки прибора (next_verification_date - lead_time_days)
  //   const calculatedActionDateSql = sql`
  //   (${devices.nextVerificationDate}::date - COALESCE(${devices.leadTimeDays}, ${companyDefaultLeadTime}) * INTERVAL '1 day')
  // `;

  //   // Вычисляем строковый ключ года-месяца "YYYY-MM" для этой даты
  //   const autoMonthKeySql = sql`to_char(${calculatedActionDateSql}, 'YYYY-MM')`;

  //   // Ключевое правило: если долг из прошлого — уходит в текущий месяц, иначе — в плановый родной
  //   const finalAutoMonthSql = sql`
  //   CASE
  //     WHEN ${calculatedActionDateSql} < ${currentMonthStart}::date THEN ${currentMonthKey}
  //     ELSE ${autoMonthKeySql}
  //   END
  // `;

  //   // Сценарий А: Получаем месяц запланированной партии для прибора (если есть активный черновик)
  //   const activeBatchMonthSql = sql`
  //   (SELECT to_char(vb.planned_date, 'YYYY-MM')
  //    FROM devices_to_batches dtb
  //    JOIN verification_batches vb ON dtb.batch_id = vb.id
  //    WHERE dtb.device_id = ${devices.id} AND vb.status IN ('draft', 'sent')
  //    LIMIT 1)
  // `;

  //   // Итоговое определение целевого месяца для прибора
  //   const targetMonthSql = sql`
  //   CASE
  //     WHEN ${activeBatchMonthSql} IS NOT NULL THEN ${activeBatchMonthSql}
  //     ELSE ${finalAutoMonthSql}
  //   END
  // `;

  //   // Определение типа размещения прибора (manual или auto)
  //   const placementTypeSql = sql`
  //   CASE
  //     WHEN ${activeBatchMonthSql} IS NOT NULL THEN 'manual'
  //     ELSE 'auto'
  //   END
  // `;

  //   // Базовые условия фильтрации (Только активные, исключая мертвые статусы и осмотры)
  //   const baseConditions = [
  //     eq(devices.archived, false),
  //     notInArray(
  //       devices.statusId,
  //       this.db
  //         .select({ id: statuses.id })
  //         .from(statuses)
  //         .where(inArray(statuses.name, excludedStatuses))
  //     ),
  //     sql`${devices.cachedControl} != 'осмотр'`,
  //     sql`${devices.nextVerificationDate} IS NOT NULL`,
  //     // Нас интересуют только приборы, которые попали в месяцы запрашиваемого года
  //     sql`${targetMonthSql} LIKE ${`${year}-%`}`,
  //   ];

  //   // -------------------------------------------------------------------------
  //   // ЗАПРОС АГРЕГАЦИИ: Считаем всё одним GROUP BY в базе данных
  //   // -------------------------------------------------------------------------
  //   const statsRows = await this.db
  //     .select({
  //       monthKey: targetMonthSql,
  //       placementType: placementTypeSql,
  //       count: sql<number>`count(*)::int`,
  //     })
  //     .from(devices)
  //     .where(and(...baseConditions))
  //     .groupBy(targetMonthSql, placementTypeSql);

  //   // -------------------------------------------------------------------------
  //   // СБОРКА РЕЗУЛЬТАТА НА СТОРОНЕ NODE.JS
  //   // -------------------------------------------------------------------------
  //   for (const row of statsRows) {
  //     const monthKey = row.monthKey as string;

  //     // Заполняем структуру, только если месяц валидный и есть в нашем запрашиваемом году
  //     if (summary[monthKey]) {
  //       if (row.placementType === 'manual') {
  //         summary[monthKey].manualCount += row.count;
  //       } else {
  //         summary[monthKey].autoCount += row.count;
  //       }
  //     }
  //   }

  //   return Object.values(summary);
  // }

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

  // async getVerificationBatches(
  //   year?: number,
  //   status?: string,
  //   type?: 'verification' | 'inspection', // Наш чистый параметр
  //   limit?: number, // 🔥 Добавили необязательный лимит
  //   offset?: number
  // ) {
  //   const constraints = [];

  //   if (status) {
  //     constraints.push(eq(verificationBatches.status, status));
  //   }

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

  //   // 🔥 ИСПРАВЛЕНО: Прямая, надёжная фильтрация по системному полю типа партии
  //   const targetType = type ?? 'verification';
  //   constraints.push(eq(verificationBatches.type, targetType));

  //   return await this.db.query.verificationBatches.findMany({
  //     where: constraints.length > 0 ? and(...constraints) : undefined,
  //     orderBy: (b, { desc }) => [desc(b.plannedDate)],
  //     limit: limit, // 🔥 Передали в Drizzle (пропустит, если undefined)
  //     offset: offset, // 🔥 Передали в Drizzle (пропустит, если undefined)
  //     with: {
  //       createdBy: true,
  //       verificationOrganization: true,
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
  //                 limit: 1,
  //               },
  //               arshinBuffers: {
  //                 orderBy: (ab, { desc }) => [desc(ab.verificationDate)],
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
    type?: 'verification' | 'inspection',
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

      if (targetType === 'verification') {
        // Мы в Журнале ПОВЕРОК: ищем самый свежий документ, который НЕ является осмотром
        matchedVerification = deviceVerifications.find(
          (v) =>
            v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
        );
      } else {
        // Мы в Журнале ОСМОТРОВ: ищем самый свежий документ, который ЯВЛЯЕТСЯ осмотром
        matchedVerification = deviceVerifications.find(
          (v) =>
            v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
        );
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

    const [verificationRecord] = await tx
      .insert(verifications)
      .values({
        deviceId: input.deviceId,
        batchId: input.batchId ?? null,
        protocolNumber: input.protocolNumber.trim().toLowerCase(),
        result: input.result.trim().toLowerCase(),
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

    // Оптимизируем поиск статусов: убираем lower(trim) из левой части SQL, так как в БД всё в нижнем регистре
    if (input.result === 'не годен') {
      const [rejectedStatus] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.name, 'забракован'));
      if (rejectedStatus) targetStatusId = rejectedStatus.id;
    } else if (input.result === 'годен') {
      const [activeStatus] = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.name, 'исправен'));
      if (activeStatus) targetStatusId = activeStatus.id;
    }

    // Обновляем статус прибора
    await tx
      .update(devices)
      .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
      .where(eq(devices.id, input.deviceId));

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
}
