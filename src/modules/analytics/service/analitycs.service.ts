import { and, eq, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { verifications } from '../../device/models/verification.model';
import { devices } from '../../device/models/device.model';
import { productionSites } from '../../location/models/productionSites.model';
import { companies } from '../../location/models/company.model';
import { cities } from '../../location/models/city.model';

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
}
