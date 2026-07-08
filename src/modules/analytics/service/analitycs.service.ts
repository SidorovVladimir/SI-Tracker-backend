import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { verifications } from '../../device/models/verification.model';
import { devices } from '../../device/models/device.model';
import { productionSites } from '../../location/models/productionSites.model';
import { companies } from '../../location/models/company.model';
import { cities } from '../../location/models/city.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { pricelistItems } from '../../budget/models/budget.model';
import { primaryStandarts } from '../../catalog/models/primaryStandarts.model';
import { statuses } from '../../catalog/models/status.model';
import { users } from '../../user/user.model';

export class AnalyticsService {
  constructor(private db: DrizzleDB) {}

  async getFinancialAnalytics(year: number, month?: number | null) {
    let startCondition = new Date(`${year}-01-01T00:00:00.000Z`);
    let endCondition = new Date(`${year}-12-31T23:59:59.999Z`);

    // 🌟 УМНЫЙ СДВИГ: Если выбран месяц, сужаем рамки SQL-запроса для КРУГОВЫХ ДИАГРАММ и KPI
    if (month && month >= 1 && month <= 12) {
      const paddedMonth = String(month).padStart(2, '0');
      startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
      endCondition = new Date(year, month, 0, 23, 59, 59, 999);
    }

    // Это условие отфильтрует карточки KPI, города, компании и подразделения
    const filterCondition = and(
      sql`${verifications.date} >= ${startCondition}`,
      sql`${verifications.date} <= ${endCondition}`
    );

    // 🌟 А ТУТ ДЛЯ ТРЕНДА МЕСЯЦЕВ мы ВСЕГДА берем полный год, чтобы график года не ломался!
    const fullYearCondition = and(
      sql`${verifications.date} >= ${new Date(`${year}-01-01T00:00:00.000Z`)}`,
      sql`${verifications.date} <= ${new Date(`${year}-12-31T23:59:59.999Z`)}`
    );

    // 1. ТРЕНД ПО МЕСЯЦАМ (Всегда за полный год для наглядности сезонности!)
    const monthlyTimeline = await this.db
      .select({
        month: sql<number>`EXTRACT(MONTH FROM ${verifications.date})::int`,
        amount: sql<number>`SUM(${verifications.cost})::float`,
      })
      .from(verifications)
      .where(fullYearCondition)
      .groupBy(sql`EXTRACT(MONTH FROM ${verifications.date})`);

    const byCities = await this.db
      .select({
        cityName: cities.name,
        amount: sql<number>`SUM(${verifications.cost})::float`,
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(cities, eq(productionSites.cityId, cities.id))
      .where(filterCondition)
      .groupBy(cities.name);

    // 3. СРЕЗ ПО КОМПАНИЯМ (ОРГАНИЗАЦИЯМ)
    const byCompanies = await this.db
      .select({
        companyName: companies.name,
        amount: sql<number>`SUM(${verifications.cost})::float`,
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(companies, eq(productionSites.companyId, companies.id))
      .where(filterCondition)
      .groupBy(companies.name);

    // 4. СРЕЗ ПО УЧАСТКАМ
    const byProductionSites = await this.db
      .select({
        siteId: productionSites.id,
        fullSiteLabel: sql<string>`CONCAT(${companies.name}, ' (', ${cities.name}, ') — ', ${productionSites.name})`,
        amount: sql<number>`SUM(${verifications.cost})::float`,
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(companies, eq(productionSites.companyId, companies.id))
      .innerJoin(cities, eq(productionSites.cityId, cities.id))
      .where(filterCondition)
      .groupBy(
        productionSites.id,
        productionSites.name,
        companies.name,
        cities.name
      );

    // Рассчитываем итоговую годовую сумму
    const totalSpent = byCompanies.reduce(
      (sum, item) => sum + (item.amount || 0),
      0
    );

    return {
      totalSpent,
      monthlyTimeline,
      byCities,
      byCompanies,
      byProductionSites,
    };
  }

  async getProductionAnalytics(year: number, month?: number | null) {
    // 1. Формируем временной интервал с учётом таймзон (как в вашей схеме)
    let startCondition = new Date(`${year}-01-01T00:00:00.000Z`);
    let endCondition = new Date(`${year}-12-31T23:59:59.999Z`);

    if (month && month >= 1 && month <= 12) {
      const paddedMonth = String(month).padStart(2, '0');
      startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
      endCondition = new Date(year, month, 0, 23, 59, 59, 999);
    }

    const dateCondition = and(
      sql`${verifications.date} >= ${startCondition}`,
      sql`${verifications.date} <= ${endCondition}`
    );

    // 2. СЧЁТЧИКИ KPI (Считаем КАЖДЫЙ документ отдельно, разделяя по условиям)
    const [totals] = await this.db
      .select({
        // Используем полное имя таблицы metrologyControleTypes вместо алиаса mct
        verified: sql<number>`
      COUNT(CASE WHEN 
        lower(${metrologyControleTypes.name}) LIKE '%поверка%' AND ${verifications.result} = 'Годен' 
      THEN 1 END)::int`,

        calibrated: sql<number>`
      COUNT(CASE WHEN 
        lower(${metrologyControleTypes.name}) LIKE '%калибровка%' AND ${verifications.result} = 'Годен' 
      THEN 1 END)::int`,

        rejected: sql<number>`
      COUNT(CASE WHEN 
        ${verifications.result} = 'Не годен' 
      THEN 1 END)::int`,

        inspected: sql<number>`
      COUNT(CASE WHEN 
        lower(${metrologyControleTypes.name}) LIKE '%осмотр%' OR 
        lower(${metrologyControleTypes.name}) LIKE '%верификация%' OR
        lower(${metrologyControleTypes.name}) LIKE '%контроль%'
      THEN 1 END)::int`,
      })
      .from(verifications)
      .leftJoin(
        metrologyControleTypes,
        eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
      )
      .where(dateCondition);

    // 3. ОБЪЕМЫ ПО ЦЕХАМ (Считаем количество документов verifications.id)
    const byProductionSites = await this.db
      .select({
        label: sql<string>`CONCAT(${companies.name}, ' (', ${cities.name}, ') — ', ${productionSites.name})`,
        count: sql<number>`COUNT(${verifications.id})::int`, // Считаем каждую операцию
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(companies, eq(productionSites.companyId, companies.id))
      .innerJoin(cities, eq(productionSites.cityId, cities.id))
      .where(dateCondition)
      .groupBy(
        productionSites.id,
        productionSites.name,
        companies.name,
        cities.name
      )
      .orderBy(sql`COUNT(${verifications.id}) DESC`);

    // 4. ОБЪЕМЫ ПО ЮРЛИЦАМ
    const byCompanies = await this.db
      .select({
        label: companies.name,
        count: sql<number>`COUNT(${verifications.id})::int`,
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(companies, eq(productionSites.companyId, companies.id))
      .where(dateCondition)
      .groupBy(companies.name)
      .orderBy(sql`COUNT(${verifications.id}) DESC`);

    // 5. ОБЪЕМЫ ПО ГОРОДАМ
    const byCities = await this.db
      .select({
        label: cities.name,
        count: sql<number>`COUNT(${verifications.id})::int`,
      })
      .from(verifications)
      .innerJoin(devices, eq(verifications.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(cities, eq(productionSites.cityId, cities.id))
      .where(dateCondition)
      .groupBy(cities.name)
      .orderBy(sql`COUNT(${verifications.id}) DESC`);

    return {
      totalVerified: totals?.verified || 0,
      totalRejected: totals?.rejected || 0,
      totalCalibrated: totals?.calibrated || 0,
      totalInspected: totals?.inspected || 0,
      byProductionSites,
      byCompanies,
      byCities,
    };
  }

  async getAdminDashboardStats() {
    // 1. Быстрый подсчет общего объема НСИ
    const [counts] = await this.db
      .select({
        devices: sql<number>`COUNT(CASE WHEN ${devices.archived} = false THEN 1 END)::int`,
        users: sql<number>`(SELECT COUNT(*)::int FROM ${users})`,
        companies: sql<number>`(SELECT COUNT(*)::int FROM ${companies})`,
        sites: sql<number>`(SELECT COUNT(*)::int FROM ${productionSites})`,
        standards: sql<number>`(SELECT COUNT(*)::int FROM ${primaryStandarts})`,
        tariffs: sql<number>`(SELECT COUNT(*)::int FROM ${pricelistItems})`,
      })
      .from(devices);

    // Подзапрос А: Находим дату САМОГО СВЕЖЕГО контроля для каждого прибора
    const latestDates = this.db
      .select({
        deviceId: verifications.deviceId,
        maxDate: sql`MAX(${verifications.date})`.as('max_date'),
      })
      .from(verifications)
      .groupBy(verifications.deviceId)
      .as('latest_dates');

    // Подзапрос Б: Вытаскиваем результат и тип контроля строго для этой КРАЙНЕЙ даты
    const latestVerifications = this.db
      .select({
        deviceId: verifications.deviceId,
        result: verifications.result,
        metrologyControleTypeId: verifications.metrologyControleTypeId,
      })
      .from(verifications)
      .innerJoin(
        latestDates,
        and(
          eq(verifications.deviceId, latestDates.deviceId),
          eq(verifications.date, latestDates.maxDate)
        )
      )
      .as('latest_verifications');

    // 2. Выборка приборов по точным метрологическим аномалиям

    // Аномалия 1: Пропуск МПИ у активных приборов
    const missingMpi = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(statuses, eq(statuses.id, devices.statusId))
      .where(
        and(
          eq(devices.archived, false),
          eq(sql`lower(${statuses.name})`, 'исправен'),
          isNull(devices.verificationInterval)
        )
      );

    // Аномалия 2: В КРАЙНЕЙ поверке забыли указать тип контроля (переписано!)
    const missingControlType = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(
        latestVerifications,
        eq(latestVerifications.deviceId, devices.id)
      )
      .where(
        and(
          eq(devices.archived, false),
          isNull(latestVerifications.metrologyControleTypeId)
        )
      );

    // Аномалия 3: Исправен, но истории нет И ПРИБОР НЕ НОВЫЙ (введен более 30 дней назад)
    const missingHistory = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(statuses, eq(statuses.id, devices.statusId))
      .leftJoin(
        latestVerifications,
        eq(latestVerifications.deviceId, devices.id)
      )
      .where(
        and(
          eq(devices.archived, false),
          eq(sql`lower(${statuses.name})`, 'исправен'),
          isNull(latestVerifications.deviceId),

          // 🌟 ИСПРАВЛЕНО: Безопасный каскад дат. Если receiptDate пустая, берем createdAt
          sql`COALESCE(${devices.receiptDate}, ${devices.createdAt}) < NOW() - INTERVAL '30 days'`
        )
      );

    // Аномалия 4: Рассинхрон — крайний контроль "Не годен", но статус висит "Исправен"
    const statusMismatch = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(statuses, eq(statuses.id, devices.statusId))
      .innerJoin(
        latestVerifications,
        eq(latestVerifications.deviceId, devices.id)
      )
      .where(
        and(
          eq(devices.archived, false),
          eq(sql`lower(${statuses.name})`, 'исправен'),
          eq(latestVerifications.result, 'Не годен')
        )
      );

    const missingEquipmentType = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(statuses, eq(statuses.id, devices.statusId))
      .where(
        and(
          eq(devices.archived, false),
          eq(sql`lower(${statuses.name})`, 'исправен'),
          isNull(devices.equipmentTypeId)
        )
      );

    const missingCsmCode = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .innerJoin(statuses, eq(statuses.id, devices.statusId))
      .where(
        and(
          eq(devices.archived, false),
          eq(sql`lower(${statuses.name})`, 'исправен'),
          or(isNull(devices.csmCode), eq(sql`trim(${devices.csmCode})`, ''))
        )
      );

    return {
      stats: counts || {
        devices: 0,
        users: 0,
        companies: 0,
        sites: 0,
        standards: 0,
        tariffs: 0,
      },
      anomalies: {
        missingMpi,
        missingControlType,
        missingHistory,
        statusMismatch,
        missingEquipmentType,
        missingCsmCode,
      },
    };
  }
}
