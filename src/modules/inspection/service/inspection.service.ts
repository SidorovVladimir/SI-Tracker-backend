import { eq, sql, inArray } from 'drizzle-orm';
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
      const deviceScopes =
        device.scopesToDevices?.map((s: any) =>
          s.scope?.name?.toLowerCase().trim()
        ) ?? [];

      // 🎯 НОВОЕ ENTERPRISE-ПРАВИЛО ИСКЛЮЧЕНИЯ ИЗ ОСМОТРОВ:
      // Если это СИ или ИО, и метролог НЕ поставил сферу "не ГР" — значит этот прибор ТОЛЬКО поверяется.
      // Мастер цеха его не обслуживает, полностью исключаем его из Журнала ТО!
      const isStrictMetrology =
        eqTypeName === 'средство измерений (си)' ||
        eqTypeName === 'испытательное оборудование (ио)';
      const isNotGr =
        deviceScopes.includes('не гр') ||
        deviceScopes.includes(
          'вне сферы государственного регулирования (не гр)'
        );

      if (isStrictMetrology && !isNotGr) {
        continue; // Прибор поверяется в ЦСМ, на странице осмотров он больше не мозолит глаза!
      }

      if (
        eqTypeName === 'средство контроля (ск)' &&
        deviceScopes.length > 0 &&
        !isNotGr
      ) {
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
    }

    // Построение годовой статистики
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

      const eqTypeName = device.equipmentType?.name?.toLowerCase().trim() ?? '';
      const deviceScopes =
        device.scopesToDevices?.map((s: any) =>
          s.scope?.name?.toLowerCase().trim()
        ) ?? [];

      // 🎯 НОВОЕ ENTERPRISE-ПРАВИЛО ИСКЛЮЧЕНИЯ ИЗ ОСМОТРОВ:
      // Если это СИ или ИО, и метролог НЕ поставил сферу "не ГР" — значит этот прибор ТОЛЬКО поверяется.
      // Мастер цеха его не обслуживает, полностью исключаем его из Журнала ТО!
      const isStrictMetrology =
        eqTypeName === 'средство измерений (си)' ||
        eqTypeName === 'испытательное оборудование (ио)';
      const isNotGr =
        deviceScopes.includes('не гр') ||
        deviceScopes.includes(
          'вне сферы государственного регулирования (не гр)'
        );

      if (isStrictMetrology && !isNotGr) {
        continue; // Прибор поверяется в ЦСМ, на странице осмотров он больше не мозолит глаза!
      }

      if (
        eqTypeName === 'средство контроля (ск)' &&
        deviceScopes.length > 0 &&
        !isNotGr
      ) {
        continue;
      }

      const latestInspection = device.verifications?.[0];
      let nextInspectDate = new Date();
      if (latestInspection?.validUntil) {
        nextInspectDate = new Date(latestInspection.validUntil);
      } else if (latestInspection?.date) {
        nextInspectDate = new Date(latestInspection.date);
        nextInspectDate.setMonth(
          nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
        );
      } else {
        const baseDate = device.receiptDate || device.releaseDate;
        if (baseDate) {
          nextInspectDate = new Date(baseDate);
          nextInspectDate.setMonth(
            nextInspectDate.getMonth() + DEFAULT_FALLBACK_MONTHS
          );
        }
      }

      const mKey = `${nextInspectDate.getFullYear()}-${String(
        nextInspectDate.getMonth() + 1
      ).padStart(2, '0')}`;
      const isOvd =
        nextInspectDate < new Date(now.getFullYear(), now.getMonth(), 1);
      const targetM = isOvd ? currentMonthKey : mKey;

      if (summaryMap[targetM] !== undefined) summaryMap[targetM]++;
    }

    const formattedSummary = Object.entries(summaryMap).map(
      ([month, count]) => ({
        month,
        autoCount: count,
        manualCount: 0,
      })
    );

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

      const [newBatch] = await tx
        .insert(verificationBatches)
        .values({
          number: `АКТ-ТО-${now.getFullYear()}${String(
            now.getMonth() + 1
          ).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
          plannedDate: now,
          status: 'completed',
          type: 'inspection',
          comment: `Внутренний обход цеха. Периодичность: ${intervalMonths} мес.`,
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
            ? 'Плановое ТО'
            : 'Выявлены дефекты при эксплуатации',
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

  async getInspectionBatchesArchive(limit: number, offset: number) {
    let rawBatches: any[] = [];

    if (this.planningService) {
      rawBatches = await this.planningService.getVerificationBatches(
        undefined,
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

    const items = rawBatches.map((batch: any) => ({
      id: batch.id,
      number: batch.number,
      date: batch.plannedDate.toISOString(),
      comment: batch.comment,
      devices: batch.devicesToBatches.map((link: any) => ({
        id: link.device.id,
        name: link.device.name,
        model: link.device.model,
        serialNumber: link.device.serialNumber,
        isSuccess: link.deviceStatus === 'returned',
      })),
    }));

    return {
      items,
      totalCount: countResult?.count ?? 0,
    };
  }
}
