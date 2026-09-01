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

interface InspectionItemInput {
  deviceId: string;
  isSuccess: boolean;
}

export class InspectionService {
  constructor(
    private db: DrizzleDB,
    private planningService?: VerificationPlanningService,
    private deviceService?: DeviceService
  ) {}

  // async getInspectionPoolByMonth(targetMonth: string, limit = 20, offset = 0) {
  //   const now = new Date();
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;

  //   // Находим UUID типа контроля "Осмотр"
  //   const [inspectionType] = await this.db
  //     .select()
  //     .from(metrologyControleTypes)
  //     .where(sql`LOWER(TRIM(name)) = 'осмотр'`);

  //   if (!inspectionType)
  //     throw new Error('Тип контроля "Осмотр" не найден в справочнике!');

  //   // Извлекаем абсолютно ВСЕ активные приборы (ВО, ИО, СИ, Индикаторы)
  //   const allDevices = await this.db.query.devices.findMany({
  //     where: eq(devices.archived, false),
  //     columns: {
  //       id: true,
  //       name: true,
  //       model: true,
  //       serialNumber: true,
  //       grsiNumber: true,
  //       receiptDate: true,
  //       releaseDate: true,
  //     },
  //     with: {
  //       status: { columns: { name: true } },
  //       equipmentType: { columns: { name: true } },
  //       scopesToDevices: {
  //         with: { scope: { columns: { name: true } } },
  //       },
  //       verifications: {
  //         where: eq(verifications.metrologyControleTypeId, inspectionType.id),
  //         orderBy: (v: any, { desc }: any) => [desc(v.date)],
  //         limit: 1,
  //       },
  //     },
  //   });

  //   const pool: any[] = [];
  //   const DEFAULT_FALLBACK_MONTHS = 12; // Если осмотров еще не было, планируем через год

  //   const summaryMap: Record<string, number> = {};
  //   for (let m = 1; m <= 12; m++) {
  //     summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
  //   }

  //   for (const device of allDevices) {
  //     const statusName = device.status?.name?.toLowerCase().trim() ?? '';
  //     if (
  //       ['длительное хранение', 'утерян', 'забракован', 'неисправен'].includes(
  //         statusName
  //       )
  //     )
  //       continue;
  //     // 1. Извлекаем текстовые значения классификации прибора
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

  //     // 🎯 ЖЕЛЕЗНОЕ СЕРВЕРНОЕ ПРАВИЛО ДЛЯ ЖУРНАЛА ТО:
  //     // Если по регламенту прибор должен ПОВЕРЯТЬСЯ, КАЛИБРОВАТЬСЯ или АТТЕСТОВЫВАТЬСЯ,
  //     // мы принудительно исключаем его из этого пула. Он уйдет в Журнал Поверок.
  //     if (targetControlName !== 'осмотр') {
  //       continue;
  //     }

  //     const latestInspection = device.verifications?.[0];

  //     let nextInspectDate = new Date();
  //     if (latestInspection?.validUntil) {
  //       nextInspectDate = new Date(latestInspection.validUntil);
  //     } else if (latestInspection?.date) {
  //       // Фолбек для старых записей, где не было valid_until
  //       nextInspectDate = new Date(latestInspection.date);
  //       nextInspectDate.setMonth(
  //         nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
  //       );
  //     } else {
  //       // Для абсолютно нового оборудования
  //       const baseDate = device.receiptDate || device.releaseDate;
  //       if (baseDate) {
  //         nextInspectDate = new Date(baseDate);
  //         nextInspectDate.setMonth(
  //           nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
  //         );
  //       }
  //     }

  //     const inspectMonthKey = `${nextInspectDate.getFullYear()}-${String(
  //       nextInspectDate.getMonth() + 1
  //     ).padStart(2, '0')}`;
  //     const isOverdue =
  //       nextInspectDate < new Date(now.getFullYear(), now.getMonth(), 1);
  //     const finalMonth = isOverdue ? currentMonthKey : inspectMonthKey;

  //     if (finalMonth === targetMonth) {
  //       pool.push({
  //         id: device.id,
  //         name: device.name,
  //         model: device.model,
  //         serialNumber: device.serialNumber,
  //         lastInspectionDate: latestInspection?.date
  //           ? latestInspection.date.toISOString()
  //           : null,
  //         validUntil: nextInspectDate.toISOString(),
  //         isOverdue,
  //         controlType: 'осмотр',
  //       });
  //     }

  //     if (summaryMap[finalMonth] !== undefined) {
  //       summaryMap[finalMonth]++;
  //     }
  //   }

  //   const formattedSummary = Object.entries(summaryMap).map(
  //     ([month, count]) => ({
  //       month,
  //       autoCount: count,
  //       manualCount: 0,
  //     })
  //   );

  //   return {
  //     items: pool.slice(offset, offset + limit),
  //     totalCount: pool.length,
  //     yearlySummary: formattedSummary,
  //   };
  // }

  // async getInspectionPoolByMonth(targetMonth: string, limit = 20, offset = 0) {
  //   const now = new Date();
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;
  //   const currentMonthStart = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}-01`;

  //   // Исключаемые мертвые статусы
  //   const excludedStatuses = [
  //     'длительное хранение',
  //     'утерян',
  //     'забракован',
  //     'неисправен',
  //   ];

  //   // Инициализируем карту для сводной статистики на 12 месяцев текущего года
  //   const summaryMap: Record<string, number> = {};
  //   for (let m = 1; m <= 12; m++) {
  //     summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
  //   }

  //   // -------------------------------------------------------------------------
  //   // ФОРМИРУЕМ SQL-ФИЛЬТР ДЛЯ ПУЛА ОСМОТРОВ
  //   // -------------------------------------------------------------------------

  //   // Вычисляем строковый ключ года-месяца "YYYY-MM" для даты следующего контроля
  //   const inspectMonthKeySql = sql`to_char(${devices.nextVerificationDate}, 'YYYY-MM')`;

  //   // Правило: если дата в прошлом (долг), то его целевой месяц — текущий, иначе — плановый родной
  //   const finalMonthSql = sql`
  //   CASE
  //     WHEN ${devices.nextVerificationDate}::date < ${currentMonthStart}::date THEN ${currentMonthKey}
  //     ELSE ${inspectMonthKeySql}
  //   END
  // `;

  //   // Условия отбора: только активные, только с целевым контролем "осмотр", совпадающие по месяцу
  //   const poolConditions = [
  //     eq(devices.archived, false),
  //     eq(devices.cachedControl, 'осмотр'), // Прямой удар по индексу кэша!
  //     sql`${devices.nextVerificationDate} IS NOT NULL`,
  //     notInArray(
  //       devices.statusId,
  //       this.db
  //         .select({ id: statuses.id })
  //         .from(statuses)
  //         .where(inArray(statuses.name, excludedStatuses))
  //     ),
  //   ];

  //   // Фильтр по запрашиваемому месяцу экрана
  //   const pageConditions = [
  //     ...poolConditions,
  //     sql`${finalMonthSql} = ${targetMonth}`,
  //   ];

  //   // -------------------------------------------------------------------------
  //   // ЗАПРОС 1: СЧИТАЕМ СВОДНУЮ СТАТИСТИКУ ЗА ГОД (Через GROUP BY в БД)
  //   // -------------------------------------------------------------------------
  //   const statsRows = await this.db
  //     .select({
  //       monthKey: finalMonthSql,
  //       count: sql<number>`count(*)::int`,
  //     })
  //     .from(devices)
  //     .where(
  //       and(
  //         ...poolConditions,
  //         sql`${finalMonthSql} LIKE ${`${now.getFullYear()}-%`}`
  //       )
  //     )
  //     .groupBy(finalMonthSql);

  //   for (const row of statsRows) {
  //     const monthKey = row.monthKey as string;
  //     if (summaryMap[monthKey] !== undefined) {
  //       summaryMap[monthKey] = row.count;
  //     }
  //   }

  //   const formattedSummary = Object.entries(summaryMap).map(
  //     ([month, count]) => ({
  //       month,
  //       autoCount: count,
  //       manualCount: 0,
  //     })
  //   );

  //   // Подсчитываем общее количество записей для пагинации страницы
  //   const [totalCountResult] = await this.db
  //     .select({ count: sql<number>`count(*)::int` })
  //     .from(devices)
  //     .where(and(...pageConditions));

  //   const totalCount = totalCountResult?.count ?? 0;

  //   if (totalCount === 0) {
  //     return { items: [], totalCount: 0, yearlySummary: formattedSummary };
  //   }

  //   // -------------------------------------------------------------------------
  //   // ЗАПРОС 2: ПОЛУЧАЕМ СТРОГО ПАГИНИРОВАННУЮ СТРАНИЦУ ДАННЫХ (Limit/Offset)
  //   // -------------------------------------------------------------------------
  //   const pageDevices = await this.db.query.devices.findMany({
  //     where: and(...pageConditions),
  //     limit,
  //     offset,
  //     orderBy: (d) => [asc(d.nextVerificationDate)], // Сортируем по приближению дедлайна
  //     columns: {
  //       id: true,
  //       name: true,
  //       model: true,
  //       serialNumber: true,
  //       nextVerificationDate: true,
  //     },
  //     with: {
  //       // Подтягиваем только 1 последний осмотр для вывода даты
  //       verifications: {
  //         orderBy: (v, { desc }) => [desc(v.date)],
  //         limit: 1,
  //         with: { metrologyControleType: true },
  //       },
  //     },
  //   });

  //   // -------------------------------------------------------------------------
  //   // ЧАСТЬ 3: ЛЕГКИЙ MAP ИЗ 20 ЗАПИСЕЙ
  //   // -------------------------------------------------------------------------
  //   const items = pageDevices.map((device) => {
  //     const latestInspection = device.verifications?.[0] || null;
  //     const isOverdue = device.nextVerificationDate
  //       ? new Date(device.nextVerificationDate) < now
  //       : false;

  //     return {
  //       id: device.id,
  //       name: device.name,
  //       model: device.model,
  //       serialNumber: device.serialNumber,
  //       lastInspectionDate: latestInspection?.date
  //         ? latestInspection.date.toISOString()
  //         : null,
  //       validUntil: device.nextVerificationDate
  //         ? new Date(device.nextVerificationDate).toISOString()
  //         : null,
  //       isOverdue,
  //       controlType: 'осмотр',
  //     };
  //   });

  //   return {
  //     items,
  //     totalCount,
  //     yearlySummary: formattedSummary,
  //   };
  // }

  // async createBulkInspection(
  //   items: InspectionItemInput[],
  //   intervalMonths: number,
  //   userId: string
  // ) {
  //   if (!items.length) return false;

  //   return await this.db.transaction(async (tx: any) => {
  //     const [inspectionType] = await tx
  //       .select()
  //       .from(metrologyControleTypes)
  //       .where(sql`LOWER(TRIM(name)) = 'осмотр'`);
  //     const [statusBroken] = await tx
  //       .select()
  //       .from(statuses)
  //       .where(sql`LOWER(TRIM(name)) = 'неисправен'`);

  //     const now = new Date();
  //     const validUntilDate = new Date();
  //     validUntilDate.setMonth(validUntilDate.getMonth() + intervalMonths);

  //     const year = now.getFullYear();
  //     const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
  //     const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

  //     const [lastBatch] = await tx
  //       .select({ number: verificationBatches.number })
  //       .from(verificationBatches)
  //       .where(
  //         and(
  //           gte(verificationBatches.plannedDate, startOfYear),
  //           lte(verificationBatches.plannedDate, endOfYear),
  //           eq(verificationBatches.type, 'inspection')
  //         )
  //       )
  //       .orderBy(desc(verificationBatches.createdAt))
  //       .limit(1);

  //     let nextSequenceNumber = 1;

  //     if (lastBatch && lastBatch.number) {
  //       const lastNumberStr = lastBatch.number;

  //       const match = lastNumberStr.match(/\d+$/);

  //       if (match) {
  //         const lastSequence = parseInt(match[0], 10);
  //         if (!isNaN(lastSequence)) {
  //           nextSequenceNumber = lastSequence + 1;
  //         }
  //       }
  //     }
  //     const formattedSequence = String(nextSequenceNumber).padStart(3, '0');

  //     const [newBatch] = await tx
  //       .insert(verificationBatches)
  //       .values({
  //         number: `О-${year}/${formattedSequence}`,
  //         plannedDate: now,
  //         status: 'completed',
  //         type: 'inspection',
  //         comment: `Внутренний осмотр. Периодичность: ${intervalMonths} мес.`,
  //         createdById: userId,
  //       })
  //       .returning();

  //     const verificationValues = [];
  //     const devicesToBatchesValues = [];
  //     const brokenDeviceIds: string[] = [];
  //     const successDeviceIds: string[] = [];

  //     for (const item of items) {
  //       verificationValues.push({
  //         deviceId: item.deviceId,
  //         date: now,
  //         validUntil: item.isSuccess ? validUntilDate : null,
  //         metrologyControleTypeId: inspectionType.id,
  //         result: item.isSuccess ? 'Годен' : 'Не годен',
  //         batchId: newBatch.id,
  //         comment: item.isSuccess
  //           ? 'Плановый осмотр'
  //           : 'Выявлены дефекты при осмотре',
  //       });

  //       devicesToBatchesValues.push({
  //         deviceId: item.deviceId,
  //         batchId: newBatch.id,
  //         deviceStatus: item.isSuccess ? 'returned' : 'dismantled',
  //       });

  //       if (item.isSuccess) successDeviceIds.push(item.deviceId);
  //       else brokenDeviceIds.push(item.deviceId);
  //     }

  //     await tx.insert(verifications).values(verificationValues);
  //     await tx.insert(devicesToBatches).values(devicesToBatchesValues);

  //     if (brokenDeviceIds.length > 0 && statusBroken) {
  //       await tx
  //         .update(devices)
  //         .set({ statusId: statusBroken.id, updatedAt: now })
  //         .where(inArray(devices.id, brokenDeviceIds));
  //     }
  //     if (successDeviceIds.length > 0) {
  //       await tx
  //         .update(devices)
  //         .set({ updatedAt: now, updatedById: userId })
  //         .where(inArray(devices.id, successDeviceIds));
  //     }

  //     return true;
  //   });
  // }

  // async getInspectionPoolByMonth(targetMonth: string, limit = 20, offset = 0) {
  //   const now = new Date();
  //   const currentMonthKey = `${now.getFullYear()}-${String(
  //     now.getMonth() + 1
  //   ).padStart(2, '0')}`;
  //   const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  //   // Исключаемые мертвые статусы
  //   const excludedStatuses = [
  //     'длительное хранение',
  //     'утерян',
  //     'забракован',
  //     'неисправен',
  //   ];

  //   // Инициализируем карту для сводной статистики на 12 месяцев текущего года
  //   const summaryMap: Record<string, number> = {};
  //   for (let m = 1; m <= 12; m++) {
  //     summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
  //   }

  //   // 1. БЫСТРЫЙ И ПЛОСКИЙ ЗАПРОС ПРИБОРОВ (Мгновенно по B-Tree индексу кэша)
  //   // Тянем только ID и дату кэша, никаких вложенных JOIN для сбора статистики
  //   const activeInspectionDevices = await this.db
  //     .select({
  //       id: devices.id,
  //       nextVerificationDate: devices.nextVerificationDate,
  //     })
  //     .from(devices)
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(devices.cachedControl, 'осмотр'), // Бьем строго в индекс кэша
  //         sql`${devices.nextVerificationDate} IS NOT NULL`,
  //         notInArray(
  //           devices.statusId,
  //           this.db
  //             .select({ id: statuses.id })
  //             .from(statuses)
  //             .where(inArray(statuses.name, excludedStatuses))
  //         )
  //       )
  //     );

  //   // Список ID приборов, которые по датам попали строго в запрашиваемый месяц экрана
  //   const targetDeviceIds: string[] = [];

  //   // 2. СЧИТАЕМ СТАТИСТИКУ ДЛЯ КАЛЕНДАРЯ НА СТОРОНЕ NODE.JS (Безопасно для PGlite)
  //   for (const device of activeInspectionDevices) {
  //     // Безопасно парсим дату "YYYY-MM-DD"
  //     const [dYear, dMonth, dDay] = device
  //       .nextVerificationDate!.split('-')
  //       .map(Number) as [number, number, number];
  //     const inspectDate = new Date(dYear, dMonth - 1, dDay);

  //     const inspectMonthKey = `${inspectDate.getFullYear()}-${String(
  //       inspectDate.getMonth() + 1
  //     ).padStart(2, '0')}`;

  //     // Проверяем просроченность (долг из прошлого)
  //     const isOverdue = inspectDate < currentMonthStart;
  //     const finalMonth = isOverdue ? currentMonthKey : inspectMonthKey;

  //     // Если прибор попал в открытый на экране месяц, запоминаем его ID для постраничной выборки
  //     if (finalMonth === targetMonth) {
  //       targetDeviceIds.push(device.id);
  //     }

  //     // Приплюсовываем в календарь текущего года
  //     if (summaryMap[finalMonth] !== undefined) {
  //       summaryMap[finalMonth]++;
  //     }
  //   }

  //   // Форматируем сводку для календаря фронтенда
  //   const formattedSummary = Object.entries(summaryMap).map(
  //     ([month, count]) => ({
  //       month,
  //       autoCount: count,
  //       manualCount: 0,
  //     })
  //   );

  //   const totalCount = targetDeviceIds.length;

  //   if (totalCount === 0) {
  //     return { items: [], totalCount: 0, yearlySummary: formattedSummary };
  //   }

  //   // 3. ПОЛУЧАЕМ ДАННЫЕ СТРОГО ДЛЯ ТЕКУЩЕЙ СТРАНИЦЫ (Пагинация по массиву ID)
  //   // Из базы выгрузится ровно 20 приборов
  //   const pageDevices = await this.db.query.devices.findMany({
  //     where: inArray(devices.id, targetDeviceIds),
  //     limit,
  //     offset,
  //     orderBy: (d) => [asc(d.nextVerificationDate)],
  //     columns: {
  //       id: true,
  //       name: true,
  //       model: true,
  //       serialNumber: true,
  //       nextVerificationDate: true,
  //     },
  //     with: {
  //       // Вытягиваем только 1 последний осмотр для отображения даты проведения
  //       verifications: {
  //         orderBy: (v, { desc }) => [desc(v.date)],
  //         limit: 1,
  //         with: { metrologyControleType: true },
  //       },
  //     },
  //   });

  //   // 4. ЛЕГКИЙ МАППИНГ 20 СТРОК СТРАНИЦЫ
  //   const items = pageDevices.map((device) => {
  //     const latestInspection = device.verifications?.[0] || null;

  //     const [dYear, dMonth, dDay] = device
  //       .nextVerificationDate!.split('-')
  //       .map(Number) as [number, number, number];
  //     const inspectDate = new Date(dYear, dMonth - 1, dDay);
  //     const isOverdue = inspectDate < currentMonthStart;

  //     return {
  //       id: device.id,
  //       name: device.name,
  //       model: device.model,
  //       serialNumber: device.serialNumber,
  //       lastInspectionDate: latestInspection?.date
  //         ? latestInspection.date.toISOString()
  //         : null,
  //       validUntil: inspectDate.toISOString(),
  //       isOverdue,
  //       controlType: 'осмотр',
  //     };
  //   });

  //   return {
  //     items,
  //     totalCount,
  //     yearlySummary: formattedSummary,
  //   };
  // }
  async createBulkInspection(
    items: InspectionItemInput[],
    intervalMonths: number,
    userId: string
  ) {
    if (!items.length) return false;

    return await this.db.transaction(async (tx: any) => {
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
      const validUntilDate = new Date();
      validUntilDate.setMonth(validUntilDate.getMonth() + intervalMonths);

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

      // 3. Создаем закрытую партию осмотра
      const [newBatch] = await tx
        .insert(verificationBatches)
        .values({
          number: `О-${year}/${formattedSequence}`,
          plannedDate: now,
          status: 'completed',
          type: 'inspection',
          comment: `Внутренний осмотр. Периодичность: ${intervalMonths} мес.`,
          createdById: userId,
        })
        .returning({ id: verificationBatches.id });

      const verificationValues = [];
      const devicesToBatchesValues = [];
      const brokenDeviceIds: string[] = [];
      const successDeviceIds: string[] = [];
      const allDeviceIds: string[] = [];

      // Формируем массивы для массовой вставки (Батчинг работает идеально)
      for (const item of items) {
        allDeviceIds.push(item.deviceId);

        verificationValues.push({
          deviceId: item.deviceId,
          date: now,
          validUntil: item.isSuccess ? validUntilDate : null,
          metrologyControleTypeId: inspectionType.id,
          result: item.isSuccess ? 'годен' : 'не годен',
          batchId: newBatch.id,
          comment: item.isSuccess
            ? 'Плановый осмотр'
            : 'Выявлены дефекты при осмотре',
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
  }

  // async getInspectionBatchesArchive(
  //   limit: number,
  //   offset: number,
  //   year: number
  // ) {
  //   let rawBatches: any[] = [];

  //   if (this.planningService) {
  //     rawBatches = await this.planningService.getVerificationBatches(
  //       year,
  //       undefined,
  //       'inspection',
  //       limit,
  //       offset
  //     );
  //   } else {
  //     throw new Error(
  //       'Сервис планирования (planningService) не инициализирован!'
  //     );
  //   }

  //   // 2. Считаем ОБЩЕЕ количество актов ТО в базе данных для пагинатора
  //   const [countResult] = await this.db
  //     .select({ count: sql<number>`count(*)::int` })
  //     .from(verificationBatches)
  //     .where(eq(verificationBatches.type, 'inspection'));

  //   const items = rawBatches.map((batch: any) => ({
  //     id: batch.id,
  //     number: batch.number,
  //     date: batch.plannedDate.toISOString(),
  //     comment: batch.comment,
  //     createdBy: batch.createdBy,
  //     devicesToBatches: (batch.devicesToBatches ?? []).map((link: any) => ({
  //       id: link.id, // ID связи из БД (гарантирует уникальность для кэша Apollo)
  //       deviceStatus: link.deviceStatus, // Исторический статус строки
  //       device: {
  //         id: link.device.id, // Чистый, неиспорченный UUID прибора для карточек и бирок
  //         name: link.device.name,
  //         model: link.device.model,
  //         serialNumber: link.device.serialNumber,
  //       },
  //     })),
  //   }));

  //   return {
  //     items,
  //     totalCount: countResult?.count ?? 0,
  //   };
  // }

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

  async getInspectionPoolByMonth(targetMonth: string, limit = 20, offset = 0) {
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

    // 2. Получаем данные СТРОГО для текущей страницы (limit/offset)
    const pageDevices = await this.db.query.devices.findMany({
      where: inArray(devices.id, targetDeviceIds),
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
