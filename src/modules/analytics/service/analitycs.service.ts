import { and, eq, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { verifications } from '../../device/models/verification.model';
import { devices } from '../../device/models/device.model';
import { productionSites } from '../../location/models/productionSites.model';
import { companies } from '../../location/models/company.model';
import { cities } from '../../location/models/city.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';

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
      byProductionSites,
      byCompanies,
      byCities,
    };
  }
}
