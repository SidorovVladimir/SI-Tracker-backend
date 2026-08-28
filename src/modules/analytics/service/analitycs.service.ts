import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';

import { devices } from '../../device/models/device.model';
import { productionSites } from '../../location/models/productionSites.model';
import { companies } from '../../location/models/company.model';
import { cities } from '../../location/models/city.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { pricelistItems } from '../../budget/models/budget.model';
import { primaryStandarts } from '../../catalog/models/primaryStandarts.model';
import { statuses } from '../../catalog/models/status.model';
import { users } from '../../user/user.model';
import { verifications } from '../../verification/models/verification.model';

export class AnalyticsService {
  constructor(private db: DrizzleDB) {}

  // async getFinancialAnalytics(year: number, month?: number | null) {
  //   let startCondition = new Date(`${year}-01-01T00:00:00.000Z`);
  //   let endCondition = new Date(`${year}-12-31T23:59:59.999Z`);

  //   // 🌟 УМНЫЙ СДВИГ: Если выбран месяц, сужаем рамки SQL-запроса для КРУГОВЫХ ДИАГРАММ и KPI
  //   if (month && month >= 1 && month <= 12) {
  //     const paddedMonth = String(month).padStart(2, '0');
  //     startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
  //     endCondition = new Date(year, month, 0, 23, 59, 59, 999);
  //   }

  //   // Это условие отфильтрует карточки KPI, города, компании и подразделения
  //   const filterCondition = and(
  //     sql`${verifications.date} >= ${startCondition}`,
  //     sql`${verifications.date} <= ${endCondition}`
  //   );

  //   // 🌟 А ТУТ ДЛЯ ТРЕНДА МЕСЯЦЕВ мы ВСЕГДА берем полный год, чтобы график года не ломался!
  //   const fullYearCondition = and(
  //     sql`${verifications.date} >= ${new Date(`${year}-01-01T00:00:00.000Z`)}`,
  //     sql`${verifications.date} <= ${new Date(`${year}-12-31T23:59:59.999Z`)}`
  //   );

  //   // 1. ТРЕНД ПО МЕСЯЦАМ (Всегда за полный год для наглядности сезонности!)
  //   const monthlyTimeline = await this.db
  //     .select({
  //       month: sql<number>`EXTRACT(MONTH FROM ${verifications.date})::int`,
  //       amount: sql<number>`SUM(${verifications.cost})::float`,
  //     })
  //     .from(verifications)
  //     .where(fullYearCondition)
  //     .groupBy(sql`EXTRACT(MONTH FROM ${verifications.date})`);

  //   const byCities = await this.db
  //     .select({
  //       cityName: cities.name,
  //       amount: sql<number>`SUM(${verifications.cost})::float`,
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(filterCondition)
  //     .groupBy(cities.name);

  //   // 3. СРЕЗ ПО КОМПАНИЯМ (ОРГАНИЗАЦИЯМ)
  //   const byCompanies = await this.db
  //     .select({
  //       companyName: companies.name,
  //       amount: sql<number>`SUM(${verifications.cost})::float`,
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .where(filterCondition)
  //     .groupBy(companies.name);

  //   // 4. СРЕЗ ПО УЧАСТКАМ
  //   const byProductionSites = await this.db
  //     .select({
  //       siteId: productionSites.id,
  //       fullSiteLabel: sql<string>`CONCAT(${companies.name}, ' (', ${cities.name}, ') — ', ${productionSites.name})`,
  //       amount: sql<number>`SUM(${verifications.cost})::float`,
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(filterCondition)
  //     .groupBy(
  //       productionSites.id,
  //       productionSites.name,
  //       companies.name,
  //       cities.name
  //     );

  //   // Рассчитываем итоговую годовую сумму
  //   const totalSpent = byCompanies.reduce(
  //     (sum, item) => sum + (item.amount || 0),
  //     0
  //   );

  //   return {
  //     totalSpent,
  //     monthlyTimeline,
  //     byCities,
  //     byCompanies,
  //     byProductionSites,
  //   };
  // }

  async getFinancialAnalytics(year: number, month?: number | null) {
    // Нативные объекты дат для безопасной фильтрации в Drizzle (без ошибок типов)
    const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
    const endOfYear = new Date(`${year}-12-31T23:59:59.999Z`);

    let startCondition = startOfYear;
    let endCondition = endOfYear;

    if (month && month >= 1 && month <= 12) {
      const paddedMonth = String(month).padStart(2, '0');
      startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
      const lastDay = new Date(year, month, 0).getDate();
      endCondition = new Date(
        `${year}-${paddedMonth}-${lastDay}T23:59:59.999Z`
      );
    }

    // Условия фильтрации нативных колонок Drizzle (Используют индекс по date мгновенно)
    const filterCondition = and(
      gte(verifications.date, startCondition),
      lte(verifications.date, endCondition)
    );
    const fullYearCondition = and(
      gte(verifications.date, startOfYear),
      lte(verifications.date, endOfYear)
    );

    // Выражение для безопасного извлечения номера месяца, работающее и в Postgres, и в PGlite (WASM)
    const monthNumSql = sql`substring(${verifications.date}::text from 6 for 2)::int`;

    // -------------------------------------------------------------------------
    // ЗАПРОС 1: ТРЕНД ПО МЕСЯЦАМ (Всегда за полный год, нативный синтаксис Drizzle)
    // -------------------------------------------------------------------------
    const monthlyTimeline = await this.db
      .select({
        month: monthNumSql,
        amount: sql`SUM(${verifications.cost})`.mapWith(Number),
      })
      .from(verifications)
      .where(fullYearCondition)
      .groupBy(monthNumSql);

    // -------------------------------------------------------------------------
    // ЗАПРОС 2: ЕДИНЫЙ ПЛОСКИЙ ЗАПРОС ДЛЯ ВСЕХ ФИНАНСОВЫХ СРЕЗОВ (Разгрузка БД на 300%)
    // Вытаскиваем сырые суммы затрат по площадкам за один проход СУБД
    // -------------------------------------------------------------------------
    const rawFinancialRows = await this.db
      .select({
        companyId: companies.id,
        companyName: companies.name,
        cityId: cities.id,
        cityName: cities.name,
        siteId: productionSites.id,
        siteName: productionSites.name,
        amount: sql`SUM(${verifications.cost})`.mapWith(Number),
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
        companies.id,
        companies.name,
        cities.id,
        cities.name
      );

    // -------------------------------------------------------------------------
    // ЭТАП 3: ГРУППИРОВКА И СУММИРОВАНИЕ В ПАМЯТИ NODE.JS (Линейная скорость O(N))
    // -------------------------------------------------------------------------
    const companyMap = new Map<
      string,
      { companyName: string; amount: number }
    >();
    const cityMap = new Map<string, { cityName: string; amount: number }>();
    const byProductionSites: Array<{
      siteId: string;
      fullSiteLabel: string;
      amount: number;
    }> = [];

    let totalSpent = 0;

    for (const row of rawFinancialRows) {
      const amount = row.amount || 0;
      totalSpent += amount;

      // Сборка финансового лейбла цеха на чистом JS (Без использования CONCAT в SQL)
      byProductionSites.push({
        siteId: row.siteId,
        fullSiteLabel: `${row.companyName} (${row.cityName}) — ${row.siteName}`,
        amount,
      });

      // Агрегируем суммы по Юрлицам
      if (!companyMap.has(row.companyId)) {
        companyMap.set(row.companyId, {
          companyName: row.companyName,
          amount: 0,
        });
      }
      companyMap.get(row.companyId)!.amount += amount;

      // Агрегируем суммы по Городам
      if (!cityMap.has(row.cityId)) {
        cityMap.set(row.cityId, { cityName: row.cityName, amount: 0 });
      }
      cityMap.get(row.cityId)!.amount += amount;
    }

    // Сортируем финансовые срезы по убыванию затрат
    byProductionSites.sort((a, b) => b.amount - a.amount);
    const byCompanies = Array.from(companyMap.values()).sort(
      (a, b) => b.amount - a.amount
    );
    const byCities = Array.from(cityMap.values()).sort(
      (a, b) => b.amount - a.amount
    );

    return {
      totalSpent,
      monthlyTimeline,
      byCities,
      byCompanies,
      byProductionSites,
    };
  }

  // async getProductionAnalytics(year: number, month?: number | null) {
  //   // 1. Формируем временной интервал с учётом таймзон (как в вашей схеме)
  //   let startCondition = new Date(`${year}-01-01T00:00:00.000Z`);
  //   let endCondition = new Date(`${year}-12-31T23:59:59.999Z`);

  //   if (month && month >= 1 && month <= 12) {
  //     const paddedMonth = String(month).padStart(2, '0');
  //     startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
  //     endCondition = new Date(year, month, 0, 23, 59, 59, 999);
  //   }

  //   const dateCondition = and(
  //     sql`${verifications.date} >= ${startCondition}`,
  //     sql`${verifications.date} <= ${endCondition}`
  //   );

  //   // 2. СЧЁТЧИКИ KPI (Считаем КАЖДЫЙ документ отдельно, разделяя по условиям)
  //   const [totals] = await this.db
  //     .select({
  //       // Используем полное имя таблицы metrologyControleTypes вместо алиаса mct
  //       verified: sql<number>`
  //     COUNT(CASE WHEN
  //       lower(${metrologyControleTypes.name}) LIKE '%поверка%' AND ${verifications.result} = 'Годен'
  //     THEN 1 END)::int`,

  //       calibrated: sql<number>`
  //     COUNT(CASE WHEN
  //       lower(${metrologyControleTypes.name}) LIKE '%калибровка%' AND ${verifications.result} = 'Годен'
  //     THEN 1 END)::int`,

  //       rejected: sql<number>`
  //     COUNT(CASE WHEN
  //       ${verifications.result} = 'Не годен'
  //     THEN 1 END)::int`,

  //       inspected: sql<number>`
  //     COUNT(CASE WHEN
  //       lower(${metrologyControleTypes.name}) LIKE '%осмотр%' OR
  //       lower(${metrologyControleTypes.name}) LIKE '%верификация%' OR
  //       lower(${metrologyControleTypes.name}) LIKE '%контроль%'
  //     THEN 1 END)::int`,
  //     })
  //     .from(verifications)
  //     .leftJoin(
  //       metrologyControleTypes,
  //       eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
  //     )
  //     .where(dateCondition);

  //   // 3. ОБЪЕМЫ ПО ЦЕХАМ (Считаем количество документов verifications.id)
  //   const byProductionSites = await this.db
  //     .select({
  //       label: sql<string>`CONCAT(${companies.name}, ' (', ${cities.name}, ') — ', ${productionSites.name})`,
  //       count: sql<number>`COUNT(${verifications.id})::int`, // Считаем каждую операцию
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(dateCondition)
  //     .groupBy(
  //       productionSites.id,
  //       productionSites.name,
  //       companies.name,
  //       cities.name
  //     )
  //     .orderBy(sql`COUNT(${verifications.id}) DESC`);

  //   // 4. ОБЪЕМЫ ПО ЮРЛИЦАМ
  //   const byCompanies = await this.db
  //     .select({
  //       label: companies.name,
  //       count: sql<number>`COUNT(${verifications.id})::int`,
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .where(dateCondition)
  //     .groupBy(companies.name)
  //     .orderBy(sql`COUNT(${verifications.id}) DESC`);

  //   // 5. ОБЪЕМЫ ПО ГОРОДАМ
  //   const byCities = await this.db
  //     .select({
  //       label: cities.name,
  //       count: sql<number>`COUNT(${verifications.id})::int`,
  //     })
  //     .from(verifications)
  //     .innerJoin(devices, eq(verifications.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(dateCondition)
  //     .groupBy(cities.name)
  //     .orderBy(sql`COUNT(${verifications.id}) DESC`);

  //   return {
  //     totalVerified: totals?.verified || 0,
  //     totalRejected: totals?.rejected || 0,
  //     totalCalibrated: totals?.calibrated || 0,
  //     totalInspected: totals?.inspected || 0,
  //     byProductionSites,
  //     byCompanies,
  //     byCities,
  //   };
  // }

  async getProductionAnalytics(year: number, month?: number | null) {
    // 1. Формируем временной интервал без таймзонных багов (Чистые ISO-строки даты)
    let startCondition = new Date(`${year}-01-01T00:00:00.000Z`);
    let endCondition = new Date(`${year}-12-31T23:59:59.999Z`);

    if (month && month >= 1 && month <= 12) {
      const paddedMonth = String(month).padStart(2, '0');
      startCondition = new Date(`${year}-${paddedMonth}-01T00:00:00.000Z`);
      // Находим последний день месяца с помощью JS
      const lastDay = new Date(year, month, 0).getDate();
      endCondition = new Date(
        `${year}-${paddedMonth}-${lastDay}T23:59:59.999Z`
      );
    }

    // Передаем объекты Date — ошибка типов ts(2769) полностью исчезнет
    const dateCondition = and(
      gte(verifications.date, startCondition),
      lte(verifications.date, endCondition)
    );

    // -------------------------------------------------------------------------
    // ЗАПРОС 1: СЧЁТЧИКИ KPI (Убрали тяжелые LIKE, заменили на прямое B-Tree равенство)
    // -------------------------------------------------------------------------
    const [totals] = await this.db
      .select({
        verified:
          sql`COUNT(CASE WHEN ${metrologyControleTypes.name} = 'поверка' AND ${verifications.result} = 'годен' THEN 1 END)`.mapWith(
            Number
          ),
        calibrated:
          sql`COUNT(CASE WHEN ${metrologyControleTypes.name} = 'калибровка' AND ${verifications.result} = 'годен' THEN 1 END)`.mapWith(
            Number
          ),
        rejected:
          sql`COUNT(CASE WHEN ${verifications.result} = 'не годен' THEN 1 END)`.mapWith(
            Number
          ),
        inspected:
          sql`COUNT(CASE WHEN ${metrologyControleTypes.name} IN ('осмотр', 'верификация', 'контроль') THEN 1 END)`.mapWith(
            Number
          ),
      })
      .from(verifications)
      .leftJoin(
        metrologyControleTypes,
        eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
      )
      .where(dateCondition);

    // -------------------------------------------------------------------------
    // ЗАПРОС 2: ЕДИНЫЙ ПЛОСКИЙ ЗАПРОС ДАННЫХ ДЛЯ ВСЕХ ГРАФИКОВ (Разгрузка БД на 300%)
    // Вытаскиваем сырые счетчики операций по площадкам за один проход СУБД
    // -------------------------------------------------------------------------
    const rawAnalyticsRows = await this.db
      .select({
        companyId: companies.id,
        companyName: companies.name,
        cityId: cities.id,
        cityName: cities.name,
        siteId: productionSites.id,
        siteName: productionSites.name,
        count: sql`COUNT(${verifications.id})`.mapWith(Number),
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
        companies.id,
        companies.name,
        cities.id,
        cities.name
      );

    // -------------------------------------------------------------------------
    // ЭТАП 3: ГРУППИРОВКА И СБОРКА СТАТИСТИКИ В ПАМЯТИ NODE.JS (Линейная скорость O(N))
    // -------------------------------------------------------------------------
    const companyMap = new Map<string, { label: string; count: number }>();
    const cityMap = new Map<string, { label: string; count: number }>();
    const byProductionSites: Array<{ label: string; count: number }> = [];

    for (const row of rawAnalyticsRows) {
      const count = row.count || 0;

      // Сборка лейблов площадок на чистом JS (Без использования CONCAT в SQL)
      byProductionSites.push({
        label: `${row.companyName} (${row.cityName}) — ${row.siteName}`,
        count,
      });

      // Агрегируем объемы по Юрлицам
      if (!companyMap.has(row.companyId)) {
        companyMap.set(row.companyId, { label: row.companyName, count: 0 });
      }
      companyMap.get(row.companyId)!.count += count;

      // Агрегируем объемы по Городам
      if (!cityMap.has(row.cityId)) {
        cityMap.set(row.cityId, { label: row.cityName, count: 0 });
      }
      cityMap.get(row.cityId)!.count += count;
    }

    // Сортируем площадки по убыванию объема (как в исходном ORDER BY)
    byProductionSites.sort((a, b) => b.count - a.count);

    // Превращаем Map в отсортированные массивы для графиков
    const byCompanies = Array.from(companyMap.values()).sort(
      (a, b) => b.count - a.count
    );
    const byCities = Array.from(cityMap.values()).sort(
      (a, b) => b.count - a.count
    );

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

  // async getAdminDashboardStats() {
  //   // 1. Быстрый подсчет общего объема НСИ
  //   const [counts] = await this.db
  //     .select({
  //       devices: sql<number>`COUNT(CASE WHEN ${devices.archived} = false THEN 1 END)::int`,
  //       users: sql<number>`(SELECT COUNT(*)::int FROM ${users})`,
  //       companies: sql<number>`(SELECT COUNT(*)::int FROM ${companies})`,
  //       sites: sql<number>`(SELECT COUNT(*)::int FROM ${productionSites})`,
  //       standards: sql<number>`(SELECT COUNT(*)::int FROM ${primaryStandarts})`,
  //       tariffs: sql<number>`(SELECT COUNT(*)::int FROM ${pricelistItems})`,
  //     })
  //     .from(devices);

  //   // Подзапрос А: Находим дату САМОГО СВЕЖЕГО контроля для каждого прибора
  //   const latestDates = this.db
  //     .select({
  //       deviceId: verifications.deviceId,
  //       maxDate: sql`MAX(${verifications.date})`.as('max_date'),
  //     })
  //     .from(verifications)
  //     .groupBy(verifications.deviceId)
  //     .as('latest_dates');

  //   // Подзапрос Б: Вытаскиваем результат и тип контроля строго для этой КРАЙНЕЙ даты
  //   const latestVerifications = this.db
  //     .select({
  //       deviceId: verifications.deviceId,
  //       result: verifications.result,
  //       metrologyControleTypeId: verifications.metrologyControleTypeId,
  //     })
  //     .from(verifications)
  //     .innerJoin(
  //       latestDates,
  //       and(
  //         eq(verifications.deviceId, latestDates.deviceId),
  //         eq(verifications.date, latestDates.maxDate)
  //       )
  //     )
  //     .as('latest_verifications');

  //   // 2. Выборка приборов по точным метрологическим аномалиям

  //   // Аномалия 1: Пропуск МПИ у активных приборов
  //   const missingMpi = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(statuses, eq(statuses.id, devices.statusId))
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(sql`lower(${statuses.name})`, 'исправен'),
  //         isNull(devices.verificationInterval)
  //       )
  //     );

  //   // Аномалия 2: В КРАЙНЕЙ поверке забыли указать тип контроля (переписано!)
  //   const missingControlType = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(
  //       latestVerifications,
  //       eq(latestVerifications.deviceId, devices.id)
  //     )
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         isNull(latestVerifications.metrologyControleTypeId)
  //       )
  //     );

  //   // Аномалия 3: Исправен, но истории нет И ПРИБОР НЕ НОВЫЙ (введен более 30 дней назад)
  //   const missingHistory = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(statuses, eq(statuses.id, devices.statusId))
  //     .leftJoin(
  //       latestVerifications,
  //       eq(latestVerifications.deviceId, devices.id)
  //     )
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(sql`lower(${statuses.name})`, 'исправен'),
  //         isNull(latestVerifications.deviceId),

  //         // 🌟 ИСПРАВЛЕНО: Безопасный каскад дат. Если receiptDate пустая, берем createdAt
  //         sql`COALESCE(${devices.receiptDate}, ${devices.createdAt}) < NOW() - INTERVAL '30 days'`
  //       )
  //     );

  //   // Аномалия 4: Рассинхрон — крайний контроль "Не годен", но статус висит "Исправен"
  //   const statusMismatch = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(statuses, eq(statuses.id, devices.statusId))
  //     .innerJoin(
  //       latestVerifications,
  //       eq(latestVerifications.deviceId, devices.id)
  //     )
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(sql`lower(${statuses.name})`, 'исправен'),
  //         eq(latestVerifications.result, 'Не годен')
  //       )
  //     );

  //   const missingEquipmentType = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(statuses, eq(statuses.id, devices.statusId))
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(sql`lower(${statuses.name})`, 'исправен'),
  //         isNull(devices.equipmentTypeId)
  //       )
  //     );

  //   const missingCsmCode = await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //     })
  //     .from(devices)
  //     .innerJoin(statuses, eq(statuses.id, devices.statusId))
  //     .where(
  //       and(
  //         eq(devices.archived, false),
  //         eq(sql`lower(${statuses.name})`, 'исправен'),
  //         or(isNull(devices.csmCode), eq(sql`trim(${devices.csmCode})`, ''))
  //       )
  //     );

  //   return {
  //     stats: counts || {
  //       devices: 0,
  //       users: 0,
  //       companies: 0,
  //       sites: 0,
  //       standards: 0,
  //       tariffs: 0,
  //     },
  //     anomalies: {
  //       missingMpi,
  //       missingControlType,
  //       missingHistory,
  //       statusMismatch,
  //       missingEquipmentType,
  //       missingCsmCode,
  //     },
  //   };
  // }

  async getAdminDashboardStats() {
    // Вычисляем порог "30 дней назад" на чистом JS (Безопасно для PGlite, без INTERVAL)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10); // "YYYY-MM-DD"

    // =========================================================================
    // ЭТАП 1: ПАРАЛЛЕЛЬНЫЙ ПОДСЧЕТ СЧЕТЧИКОВ (Вместо скрытого цикла в 100k итераций)
    // =========================================================================
    const [
      deviceCount,
      userCount,
      companyCount,
      siteCount,
      standardCount,
      tariffCount,
    ] = await Promise.all([
      this.db
        .select({ count: sql`count(${devices.id})`.mapWith(Number) })
        .from(devices)
        .where(eq(devices.archived, false)),
      this.db.select({ count: sql`count(*)`.mapWith(Number) }).from(users),
      this.db.select({ count: sql`count(*)`.mapWith(Number) }).from(companies),
      this.db
        .select({ count: sql`count(*)`.mapWith(Number) })
        .from(productionSites),
      this.db
        .select({ count: sql`count(*)`.mapWith(Number) })
        .from(primaryStandarts),
      this.db
        .select({ count: sql`count(*)`.mapWith(Number) })
        .from(pricelistItems),
    ]);

    const counts = {
      devices: deviceCount[0]?.count || 0,
      users: userCount[0]?.count || 0,
      companies: companyCount[0]?.count || 0,
      sites: siteCount[0]?.count || 0,
      standards: standardCount[0]?.count || 0,
      tariffs: tariffCount[0]?.count || 0,
    };

    // =========================================================================
    // ЭТАП 2: ВЫБОРКА АНОМАЛИЙ (Чистые линейные запросы по B-Tree индексам)
    // =========================================================================

    // Справочник: Находим ID статуса "исправен" один раз, чтобы не делать джоины в циклах
    const [activeStatus] = await this.db
      .select({ id: statuses.id })
      .from(statuses)
      .where(eq(statuses.name, 'исправен'));
    const activeStatusId = activeStatus?.id;

    if (!activeStatusId) {
      throw new Error(
        'Критический статус "исправен" отсутствует в справочнике системы!'
      );
    }

    // Аномалия 1: Пропуск МПИ у активных исправных приборов
    const missingMpi = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.statusId, activeStatusId),
          isNull(devices.verificationInterval)
        )
      );

    // Аномалия 2: В КРАЙНЕЙ поверке забыли указать тип контроля
    // Используем LATERAL-подзапрос (самый быстрый паттерн получения крайней записи в Postgres/PGlite)
    const missingControlType = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .leftJoin(
        verifications,
        eq(
          verifications.id,
          sql`(
        SELECT sub_v.id FROM ${verifications} sub_v 
        WHERE sub_v.device_id = ${devices.id} 
        ORDER BY sub_v.date DESC NULLS LAST, sub_v.created_at DESC LIMIT 1
      )`
        )
      )
      .where(
        and(
          eq(devices.archived, false),
          isNull(verifications.metrologyControleTypeId)
        )
      );

    // Аномалия 3: Исправен, но истории нет И ПРИБОР НЕ НОВЫЙ (введен более 30 дней назад)
    // Используем наш безопасный JS-таймстамп thirtyDaysAgoStr
    const missingHistory = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .leftJoin(
        verifications,
        eq(
          verifications.id,
          sql`(
        SELECT sub_v.id FROM ${verifications} sub_v 
        WHERE sub_v.device_id = ${devices.id} 
        ORDER BY sub_v.date DESC NULLS LAST, sub_v.created_at DESC LIMIT 1
      )`
        )
      )
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.statusId, activeStatusId),
          isNull(verifications.id), // Документов нет вообще
          // Проверяем каскад дат: если receiptDate пустая, смотрим на createdAt (приводим к типу даты)
          sql`COALESCE(${devices.receiptDate}::text, ${devices.createdAt}::text)::date < ${thirtyDaysAgoStr}::date`
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
      .innerJoin(
        verifications,
        eq(
          verifications.id,
          sql`(
        SELECT sub_v.id FROM ${verifications} sub_v 
        WHERE sub_v.device_id = ${devices.id} 
        ORDER BY sub_v.date DESC NULLS LAST, sub_v.created_at DESC LIMIT 1
      )`
        )
      )
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.statusId, activeStatusId),
          eq(verifications.result, 'Не годен')
        )
      );

    // Аномалия 5: Отсутствует тип оборудования (СИ / ИО / СК) у исправного прибора
    const missingEquipmentType = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.statusId, activeStatusId),
          isNull(devices.equipmentTypeId)
        )
      );

    // Аномалия 6: Исправен, но код ЦСМ пустой или пробельный
    const missingCsmCode = await this.db
      .select({
        id: devices.id,
        name: devices.name,
        model: devices.model,
        serialNumber: devices.serialNumber,
      })
      .from(devices)
      .where(
        and(
          eq(devices.archived, false),
          eq(devices.statusId, activeStatusId),
          or(isNull(devices.csmCode), sql`trim(${devices.csmCode}) = ''`)
        )
      );

    // 3. ВОЗВРАЩАЕМ ИДЕАЛЬНО ФОРМАТИРОВАННЫЙ ОТВЕТ ДЛЯ ДАШБОРДА
    return {
      stats: counts,
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
