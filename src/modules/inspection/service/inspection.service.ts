import { eq, sql, inArray, and, gte, lte, desc } from 'drizzle-orm';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import {
  devices,
  devicesToBatches,
  verificationBatches,
} from '../../device/models/device.model';
import { verifications } from '../../device/models/verification.model';
import { statuses } from '../../catalog/models/status.model';
import { DrizzleDB } from '../../../db/client';
import { VerificationPlanningService } from '../../device/service/verificationPlanningService';

interface InspectionItemInput {
  deviceId: string;
  isSuccess: boolean;
}

export class InspectionService {
  constructor(
    private db: DrizzleDB,
    private planningService?: VerificationPlanningService
  ) {}

  /**
   * 1. ПОЛУЧИТЬ ПУЛ НА ОСМОТР (Календарь + Таблица)
   */
  async getInspectionPoolByMonth(targetMonth: string, limit = 20, offset = 0) {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, '0')}`;

    // Находим UUID типа контроля "Осмотр"
    const [inspectionType] = await this.db
      .select()
      .from(metrologyControleTypes)
      .where(sql`LOWER(TRIM(name)) = 'осмотр'`);

    if (!inspectionType)
      throw new Error('Тип контроля "Осмотр" не найден в справочнике!');

    // Извлекаем абсолютно ВСЕ активные приборы (ВО, ИО, СИ, Индикаторы)
    const allDevices = await this.db.query.devices.findMany({
      where: eq(devices.archived, false),
      columns: {
        id: true,
        name: true,
        model: true,
        serialNumber: true,
        grsiNumber: true,
        receiptDate: true,
        releaseDate: true,
      },
      with: {
        status: { columns: { name: true } },
        equipmentType: { columns: { name: true } },
        scopesToDevices: {
          with: { scope: { columns: { name: true } } },
        },
        verifications: {
          where: eq(verifications.metrologyControleTypeId, inspectionType.id),
          orderBy: (v: any, { desc }: any) => [desc(v.date)],
          limit: 1,
        },
      },
    });

    const pool: any[] = [];
    const DEFAULT_FALLBACK_MONTHS = 12; // Если осмотров еще не было, планируем через год

    const summaryMap: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
    }

    for (const device of allDevices) {
      const statusName = device.status?.name?.toLowerCase().trim() ?? '';
      if (
        ['длительное хранение', 'утерян', 'забракован', 'неисправен'].includes(
          statusName
        )
      )
        continue;
      // 1. Извлекаем текстовые значения классификации прибора
      const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
      const grsiNumber = device.grsiNumber;
      const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';
      const deviceScopes =
        device.scopesToDevices?.map((s: any) =>
          s.scope?.name?.toLowerCase().trim()
        ) ?? [];

      // 🎯 НОВОЕ ENTERPRISE-ПРАВИЛО ИСКЛЮЧЕНИЯ ИЗ ОСМОТРОВ:
      // Если это СИ или ИО, и метролог НЕ поставил сферу "не ГР" — значит этот прибор ТОЛЬКО поверяется.
      // Мастер цеха его не обслуживает, полностью исключаем его из Журнала ТО!
      // const isStrictMetrology =
      //   eqTypeName === 'средство измерений (си)' ||
      //   eqTypeName === 'испытательное оборудование (ио)';
      const isNotGr =
        deviceScopes.includes('не гр') ||
        deviceScopes.includes(
          'вне сферы государственного регулирования (не гр)'
        );

      // if (isStrictMetrology && !isNotGr) {
      //   continue; // Прибор поверяется в ЦСМ, на странице осмотров он больше не мозолит глаза!
      // }

      // if (
      //   eqTypeName === 'средство контроля (ск)' &&
      //   deviceScopes.length > 0 &&
      //   !isNotGr
      // ) {
      //   continue;
      // }
      // 🎯 ВЫЧИСЛЯЕМ ЦЕЛЕВОЙ КОНТРОЛЬ ПО ОФИЦИАЛЬНЫМ ПРАВИЛАМ МЕТРОЛОГА
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

      // 🎯 ЖЕЛЕЗНОЕ СЕРВЕРНОЕ ПРАВИЛО ДЛЯ ЖУРНАЛА ТО:
      // Если по регламенту прибор должен ПОВЕРЯТЬСЯ, КАЛИБРОВАТЬСЯ или АТТЕСТОВЫВАТЬСЯ,
      // мы принудительно исключаем его из этого пула. Он уйдет в Журнал Поверок.
      if (targetControlName !== 'осмотр') {
        continue;
      }

      const latestInspection = device.verifications?.[0];

      let nextInspectDate = new Date();
      if (latestInspection?.validUntil) {
        nextInspectDate = new Date(latestInspection.validUntil);
      } else if (latestInspection?.date) {
        // Фолбек для старых записей, где не было valid_until
        nextInspectDate = new Date(latestInspection.date);
        nextInspectDate.setMonth(
          nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
        );
      } else {
        // Для абсолютно нового оборудования
        const baseDate = device.receiptDate || device.releaseDate;
        if (baseDate) {
          nextInspectDate = new Date(baseDate);
          nextInspectDate.setMonth(
            nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
          );
        }
      }

      const inspectMonthKey = `${nextInspectDate.getFullYear()}-${String(
        nextInspectDate.getMonth() + 1
      ).padStart(2, '0')}`;
      const isOverdue =
        nextInspectDate < new Date(now.getFullYear(), now.getMonth(), 1);
      const finalMonth = isOverdue ? currentMonthKey : inspectMonthKey;

      if (finalMonth === targetMonth) {
        pool.push({
          id: device.id,
          name: device.name,
          model: device.model,
          serialNumber: device.serialNumber,
          lastInspectionDate: latestInspection?.date
            ? latestInspection.date.toISOString()
            : null,
          validUntil: nextInspectDate.toISOString(),
          isOverdue,
          controlType: 'осмотр',
        });
      }

      if (summaryMap[finalMonth] !== undefined) {
        summaryMap[finalMonth]++;
      }
    }

    const formattedSummary = Object.entries(summaryMap).map(
      ([month, count]) => ({
        month,
        autoCount: count,
        manualCount: 0,
      })
    );

    // Построение годовой статистики
    // const summaryMap: Record<string, number> = {};
    // for (let m = 1; m <= 12; m++) {
    //   summaryMap[`${now.getFullYear()}-${String(m).padStart(2, '0')}`] = 0;
    // }

    // for (const device of allDevices) {
    //   const statusName = device.status?.name?.toLowerCase().trim() ?? '';
    //   if (
    //     ['длительное хранение', 'утерян', 'забракован', 'неисправен'].includes(
    //       statusName
    //     )
    //   )
    //     continue;

    //   const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
    //   const deviceScopes =
    //     device.scopesToDevices?.map((s: any) =>
    //       s.scope?.name?.toLowerCase().trim()
    //     ) ?? [];

    //   // 🎯 НОВОЕ ENTERPRISE-ПРАВИЛО ИСКЛЮЧЕНИЯ ИЗ ОСМОТРОВ:
    //   // Если это СИ или ИО, и метролог НЕ поставил сферу "не ГР" — значит этот прибор ТОЛЬКО поверяется.
    //   // Мастер цеха его не обслуживает, полностью исключаем его из Журнала ТО!
    //   const isStrictMetrology =
    //     eqTypeName === 'средство измерений (си)' ||
    //     eqTypeName === 'испытательное оборудование (ио)';
    //   const isNotGr =
    //     deviceScopes.includes('не гр') ||
    //     deviceScopes.includes(
    //       'вне сферы государственного регулирования (не гр)'
    //     );

    //   if (isStrictMetrology && !isNotGr) {
    //     continue; // Прибор поверяется в ЦСМ, на странице осмотров он больше не мозолит глаза!
    //   }

    //   if (
    //     eqTypeName === 'средство контроля (ск)' &&
    //     deviceScopes.length > 0 &&
    //     !isNotGr
    //   ) {
    //     continue;
    //   }

    //   const latestInspection = device.verifications?.[0];
    //   let nextInspectDate = new Date();
    //   if (latestInspection?.validUntil) {
    //     nextInspectDate = new Date(latestInspection.validUntil);
    //   } else if (latestInspection?.date) {
    //     nextInspectDate = new Date(latestInspection.date);
    //     nextInspectDate.setMonth(
    //       nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
    //     );
    //   } else {
    //     const baseDate = device.receiptDate || device.releaseDate;
    //     if (baseDate) {
    //       nextInspectDate = new Date(baseDate);
    //       nextInspectDate.setMonth(
    //         nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
    //       );
    //     }
    //   }

    //   const mKey = `${nextInspectDate.getFullYear()}-${String(
    //     nextInspectDate.getMonth() + 1
    //   ).padStart(2, '0')}`;
    //   const isOvd =
    //     nextInspectDate < new Date(now.getFullYear(), now.getMonth(), 1);
    //   const targetM = isOvd ? currentMonthKey : mKey;

    //   if (summaryMap[targetM] !== undefined) summaryMap[targetM]++;
    // }

    // const formattedSummary = Object.entries(summaryMap).map(
    //   ([month, count]) => ({
    //     month,
    //     autoCount: count,
    //     manualCount: 0,
    //   })
    // );

    return {
      items: pool.slice(offset, offset + limit),
      totalCount: pool.length,
      yearlySummary: formattedSummary,
    };
  }

  /**
   * 2. МАССОВОЕ СОХРАНЕНИЕ ВЫПОЛНЕННЫХ ОСМОТРОВ
   */
  // async createBulkInspection(
  //   deviceIds: string[],
  //   intervalMonths: number,
  //   userId: string
  // ) {
  //   if (!deviceIds.length) return false;

  //   return await this.db.transaction(async (tx: any) => {
  //     const [inspectionType] = await tx
  //       .select()
  //       .from(metrologyControleTypes)
  //       .where(sql`LOWER(TRIM(name)) = 'осмотр'`);

  //     const now = new Date();
  //     // Вычисляем жесткую дату следующего контроля на основе переданного интервала
  //     const validUntilDate = new Date();
  //     validUntilDate.setMonth(validUntilDate.getMonth() + intervalMonths);

  //     const inspectionValues = deviceIds.map((id) => ({
  //       // id: crypto.randomUUID(),
  //       deviceId: id,
  //       date: now,
  //       validUntil: validUntilDate, // Записали срок действия осмотра!
  //       metrologyControleTypeId: inspectionType.id,
  //       result: 'Годен',
  //       comment: `Групповая фиксация обхода. Периодичность: ${intervalMonths} мес.`,
  //     }));

  //     await tx.insert(verifications).values(inspectionValues);
  //     await tx
  //       .update(devices)
  //       .set({ updatedAt: new Date(), updatedById: userId })
  //       .where(inArray(devices.id, deviceIds));

  //     return true;
  //   });
  // }

  async createBulkInspection(
    items: InspectionItemInput[],
    intervalMonths: number,
    userId: string
  ) {
    if (!items.length) return false;

    return await this.db.transaction(async (tx: any) => {
      const [inspectionType] = await tx
        .select()
        .from(metrologyControleTypes)
        .where(sql`LOWER(TRIM(name)) = 'осмотр'`);
      const [statusBroken] = await tx
        .select()
        .from(statuses)
        .where(sql`LOWER(TRIM(name)) = 'неисправен'`);

      const now = new Date();
      const validUntilDate = new Date();
      validUntilDate.setMonth(validUntilDate.getMonth() + intervalMonths);

      const year = now.getFullYear();
      const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
      const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

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
        .returning();

      const verificationValues = [];
      const devicesToBatchesValues = [];
      const brokenDeviceIds: string[] = [];
      const successDeviceIds: string[] = [];

      for (const item of items) {
        verificationValues.push({
          deviceId: item.deviceId,
          date: now,
          validUntil: item.isSuccess ? validUntilDate : null,
          metrologyControleTypeId: inspectionType.id,
          result: item.isSuccess ? 'Годен' : 'Не годен',
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

      await tx.insert(verifications).values(verificationValues);
      await tx.insert(devicesToBatches).values(devicesToBatchesValues);

      if (brokenDeviceIds.length > 0 && statusBroken) {
        await tx
          .update(devices)
          .set({ statusId: statusBroken.id, updatedAt: now })
          .where(inArray(devices.id, brokenDeviceIds));
      }
      if (successDeviceIds.length > 0) {
        await tx
          .update(devices)
          .set({ updatedAt: now, updatedById: userId })
          .where(inArray(devices.id, successDeviceIds));
      }

      return true;
    });
  }

  async getInspectionBatchesArchive(
    limit: number,
    offset: number,
    year: number
  ) {
    let rawBatches: any[] = [];

    if (this.planningService) {
      rawBatches = await this.planningService.getVerificationBatches(
        year,
        undefined,
        'inspection',
        limit,
        offset
      );
    } else {
      throw new Error(
        'Сервис планирования (planningService) не инициализирован!'
      );
    }

    // 2. Считаем ОБЩЕЕ количество актов ТО в базе данных для пагинатора
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(verificationBatches)
      .where(eq(verificationBatches.type, 'inspection'));

    // const items = rawBatches.map((batch: any) => ({
    //   id: batch.id,
    //   number: batch.number,
    //   date: batch.plannedDate.toISOString(),
    //   comment: batch.comment,
    //   devices: batch.devicesToBatches.map((link: any) => ({
    //     id: link.device.id,
    //     name: link.device.name,
    //     model: link.device.model,
    //     serialNumber: link.device.serialNumber,
    //     isSuccess: link.deviceStatus === 'returned',
    //   })),
    // }));

    const items = rawBatches.map((batch: any) => ({
      id: batch.id,
      number: batch.number,
      date: batch.plannedDate.toISOString(),
      comment: batch.comment,
      createdBy: batch.createdBy,
      devicesToBatches: (batch.devicesToBatches ?? []).map((link: any) => ({
        id: link.id, // ID связи из БД (гарантирует уникальность для кэша Apollo)
        deviceStatus: link.deviceStatus, // Исторический статус строки
        device: {
          id: link.device.id, // Чистый, неиспорченный UUID прибора для карточек и бирок
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
}
