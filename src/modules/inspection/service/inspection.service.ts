import { eq, sql, inArray } from 'drizzle-orm';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { devices } from '../../device/models/device.model';
import { verifications } from '../../device/models/verification.model';

export class InspectionService {
  constructor(private db: any) {}

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
        verifications: {
          where: eq(verifications.metrologyControleTypeId, inspectionType.id),
          orderBy: (v: any, { desc }: any) => [desc(v.date)],
          limit: 1,
        },
      },
    });

    const pool: any[] = [];
    const INSPECTION_INTERVAL_MONTHS = 1; // Внутренний регламент обхода завода

    for (const device of allDevices) {
      const statusName = device.status?.name?.toLowerCase().trim() ?? '';
      if (['длительное хранение', 'утерян'].includes(statusName)) continue;

      const latestInspection = device.verifications?.[0];

      let nextInspectDate = new Date();
      if (latestInspection?.date) {
        nextInspectDate = new Date(latestInspection.date);
        nextInspectDate.setMonth(
          nextInspectDate.getMonth() + INSPECTION_INTERVAL_MONTHS
        );
      } else {
        const baseDate = device.receiptDate || device.releaseDate;
        if (baseDate) {
          nextInspectDate = new Date(baseDate);
          nextInspectDate.setMonth(
            nextInspectDate.getMonth() + INSPECTION_INTERVAL_MONTHS
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
          controlType: 'Осмотр',
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
      if (['длительное хранение', 'утерян'].includes(statusName)) continue;

      const latestInspection = device.verifications?.[0];
      let nextInspectDate = new Date();
      if (latestInspection?.date) {
        nextInspectDate = new Date(latestInspection.date);
        nextInspectDate.setMonth(
          nextInspectDate.getMonth() + INSPECTION_INTERVAL_MONTHS
        );
      } else {
        const baseDate = device.receiptDate || device.releaseDate;
        if (baseDate) {
          nextInspectDate = new Date(baseDate);
          nextInspectDate.setMonth(
            nextInspectDate.getMonth() + INSPECTION_INTERVAL_MONTHS
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
  async createBulkInspection(deviceIds: string[], userId: string) {
    if (!deviceIds.length) return false;

    return await this.db.transaction(async (tx: any) => {
      const [inspectionType] = await tx
        .select()
        .from(metrologyControleTypes)
        .where(sql`LOWER(TRIM(name)) = 'осмотр'`);

      const inspectionValues = deviceIds.map((id) => ({
        id: crypto.randomUUID(),
        deviceId: id,
        date: new Date(),
        metrologyControleTypeId: inspectionType.id,
        result: 'Осмотрено. Нарушений не выявлено.',
        comment: 'Групповая фиксация обхода мастером',
      }));

      await tx.insert(verifications).values(inspectionValues);
      await tx
        .update(devices)
        .set({ updatedAt: new Date() })
        .where(inArray(devices.id, deviceIds));

      return true;
    });
  }
}
