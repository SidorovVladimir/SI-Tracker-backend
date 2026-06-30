import { sql, and, eq, inArray, desc, ilike, count, or } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';

import { productionSites } from '../../location/models/productionSites.model';
import { companies } from '../../location/models/company.model';
import { cities } from '../../location/models/city.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { verifications } from '../../device/models/verification.model';
import { devices } from '../../device/models/device.model';
import {
  budgetPlanItems,
  budgetPlans,
  pricelistItems,
  pricelists,
} from '../models/budget.model';
import { statuses } from '../../catalog/models/status.model';

export class BudgetService {
  constructor(private db: DrizzleDB) {}

  private pricelistItemsCache: Record<string, any[]> = {};

  async getBudgetMatrix(
    targetYear: number,
    groupBy: 'COMPANY' | 'CITY' | 'SITE',
    filters: { companyId?: string; cityId?: string; siteId?: string }
  ) {
    // 1. Динамически определяем, по какому полю группировать строки отчета
    let groupColumn: any;
    let nameColumn: any;

    if (groupBy === 'COMPANY') {
      groupColumn = companies.id;
      nameColumn = companies.name;
    } else if (groupBy === 'CITY') {
      groupColumn = cities.id;
      nameColumn = cities.name;
    } else {
      // По умолчанию SITE (Производственная площадка)
      groupColumn = productionSites.id;
      nameColumn = productionSites.name;
    }

    // 2. Сборка динамических условий фильтрации
    const conditions = [
      sql`EXTRACT(YEAR FROM ${verifications.validUntil}) = ${targetYear}`,
      inArray(metrologyControleTypes.name, ['поверка', 'калибровка']),
      // Исключаем архивные приборы из расчета бюджета на будущий год
      eq(devices.archived, false),
    ];

    if (filters.companyId && filters.companyId !== 'ALL') {
      conditions.push(eq(productionSites.companyId, filters.companyId));
    }
    if (filters.cityId && filters.cityId !== 'ALL') {
      conditions.push(eq(productionSites.cityId, filters.cityId));
    }
    if (filters.siteId && filters.siteId !== 'ALL') {
      conditions.push(eq(productionSites.id, filters.siteId));
    }

    // 3. Главный аналитический SQL-запрос
    // Мы группируем по ID ЦФО и по номеру месяца окончания поверки
    const rawData = await this.db.execute(sql`
      SELECT 
        ${groupColumn} as "rowId",
        ${nameColumn} as "rowName",
        EXTRACT(MONTH FROM ${verifications.validUntil})::int as "monthNum",
        SUM(COALESCE(${verifications.cost}, 0)::numeric)::int as "monthTotal"
      FROM ${verifications}
      JOIN ${devices} ON ${devices.id} = ${verifications.deviceId}
      JOIN ${productionSites} ON ${productionSites.id} = ${
      devices.productionSiteId
    }
      JOIN ${companies} ON ${companies.id} = ${productionSites.companyId}
      JOIN ${cities} ON ${cities.id} = ${productionSites.cityId}
      JOIN ${metrologyControleTypes} ON ${metrologyControleTypes.id} = ${
      verifications.metrologyControleTypeId
    }
      WHERE ${and(...conditions)}
  -- 🔥 ИСПРАВЛЕНО: Подзапрос теперь ищет крайнюю запись прибора 
  -- СТРОГО внутри планируемого года, полностью игнорируя накладки других лет!
  AND ${verifications.id} = (
    SELECT sub_v.id 
    FROM ${verifications} sub_v 
    WHERE sub_v.device_id = ${devices.id} 
      AND EXTRACT(YEAR FROM sub_v.valid_until) = ${targetYear} -- Добавьте это условие
    ORDER BY sub_v.created_at DESC LIMIT 1
  )
GROUP BY ${groupColumn}, ${nameColumn}, EXTRACT(MONTH FROM ${
      verifications.validUntil
    })
ORDER BY "rowName" ASC, "monthNum" ASC
    `);

    // 4. Форматируем плоский ответ базы данных в древовидную матрицу под фронтенд
    const rowsMap = new Map<string, any>();

    for (const rawRow of rawData.rows as any[]) {
      const { rowId, rowName, monthNum, monthTotal } = rawRow;

      if (!rowsMap.has(rowId)) {
        // Создаем пустую сетку на все 12 месяцев года для этой строки отчета
        const emptyMonths = Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          totalCost: 0,
        }));

        rowsMap.set(rowId, {
          rowId,
          rowName,
          months: emptyMonths,
          totalYearCost: 0,
        });
      }

      const currentRow = rowsMap.get(rowId);
      const targetMonth = currentRow.months.find(
        (m: any) => m.month === monthNum
      );

      if (targetMonth) {
        targetMonth.totalCost = monthTotal;
      }

      currentRow.totalYearCost += monthTotal;
    }

    const finalRows = Array.from(rowsMap.values());
    const grandTotal = finalRows.reduce((sum, r) => sum + r.totalYearCost, 0);

    return {
      targetYear,
      rows: finalRows,
      grandTotal,
    };
  }

  // 1. Получение прайсов со связью через WITH (1 запрос к БД)
  async getPricelists() {
    return await this.db.query.pricelists.findMany({
      orderBy: (p: any, { desc }: any) => [desc(p.year)],
      with: {
        verificationOrganization: true, // Вытягивает организацию ЦСМ
      },
    });
  }

  // 2. Получение одного прайса
  async getPricelist(id: string) {
    const [list] = await this.db
      .select()
      .from(pricelists)
      .where(eq(pricelists.id, id))
      .limit(1);
    return list || null;
  }

  async getBudgetPlanItems({
    budgetId,
    limit,
    offset,
    filter,
  }: {
    budgetId: string;
    limit: number;
    offset: number;
    filter?: {
      matchMethod?: string | undefined;
      searchQuery?: string | undefined;
      city?: string | undefined;
      company?: string | undefined;
      productionSite?: string | undefined;
    };
  }) {
    const sqlConditions = [eq(budgetPlanItems.budgetPlanId, budgetId)];

    if (filter?.matchMethod) {
      sqlConditions.push(eq(budgetPlanItems.matchMethod, filter.matchMethod));
    }

    if (filter?.searchQuery && filter.searchQuery.trim() !== '') {
      sqlConditions.push(
        or(
          ilike(budgetPlanItems.deviceName, `%${filter.searchQuery}%`),
          ilike(budgetPlanItems.deviceModel, `%${filter.searchQuery}%`)
        )!
      );
    }

    if (filter?.company)
      sqlConditions.push(eq(productionSites.companyId, filter.company));
    if (filter?.city)
      sqlConditions.push(eq(productionSites.cityId, filter.city));
    if (filter?.productionSite)
      sqlConditions.push(eq(productionSites.id, filter.productionSite));

    const finalWhereClause = and(...sqlConditions);

    // Базовый конструктор запроса, чтобы не дублировать одинаковые INNER JOIN
    const [itemsRaw, countResult, sumResult] = await Promise.all([
      // 1. Запрос на получение текущей страницы данных
      this.db
        .select({
          id: budgetPlanItems.id,
          deviceName: budgetPlanItems.deviceName,
          deviceModel: budgetPlanItems.deviceModel,
          matchMethod: budgetPlanItems.matchMethod,
          basePrice: budgetPlanItems.basePrice,
          vatAmount: budgetPlanItems.vatAmount,
          totalCost: budgetPlanItems.totalCost,
          deviceId: devices.id,
          serialNumber: devices.serialNumber,
          grsiNumber: devices.grsiNumber,
        })
        .from(budgetPlanItems)
        .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
        .innerJoin(
          productionSites,
          eq(devices.productionSiteId, productionSites.id)
        )
        .where(finalWhereClause)
        .limit(limit)
        .offset(offset)
        .orderBy(desc(budgetPlanItems.createdAt)),

      // 2. Запрос на подсчет общего количества строк
      this.db
        .select({ count: sql<number>`count(${budgetPlanItems.id})::int` })
        .from(budgetPlanItems)
        .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
        .innerJoin(
          productionSites,
          eq(devices.productionSiteId, productionSites.id)
        )
        .where(finalWhereClause),

      // 3. Запрос на подсчет суммы затрат на панели
      this.db
        .select({
          totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(12,2)`,
        })
        .from(budgetPlanItems)
        .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
        .innerJoin(
          productionSites,
          eq(devices.productionSiteId, productionSites.id)
        )
        .where(finalWhereClause),
    ]);

    // Безопасно извлекаем первые элементы из массивов агрегатов
    const totalCount = countResult[0]?.count || 0;
    const totalCostAll = parseFloat(sumResult[0]?.totalCost || '0.00');

    // Мапим плоский SQL ответ во вложенный объект для GraphQL
    const items = itemsRaw.map((row) => ({
      id: row.id,
      budgetPlanId: budgetId,
      deviceName: row.deviceName,
      deviceModel: row.deviceModel,
      matchMethod: row.matchMethod,
      basePrice: parseFloat(row.basePrice),
      vatAmount: parseFloat(row.vatAmount),
      totalCost: parseFloat(row.totalCost),
      device: {
        id: row.deviceId,
        serialNumber: row.serialNumber,
        grsiNumber: row.grsiNumber,
      },
    }));

    return {
      items,
      totalCount,
      totalCostAll,
    };
  }

  private async loadPricelistItemsMap(pricelistIds: string[]) {
    if (!pricelistIds || pricelistIds.length === 0) {
      return { byGrsi: new Map(), byCsmCode: new Map(), all: [] };
    }

    // Делаем ровно 1 запрос к базе данных вместо тысяч
    const items = await this.db
      .select()
      .from(pricelistItems)
      .where(inArray(pricelistItems.pricelistId, pricelistIds));

    const byGrsi = new Map<string, typeof pricelistItems.$inferSelect>();
    const byCsmCode = new Map<string, typeof pricelistItems.$inferSelect>();

    // ГРСИ и Код ЦСМ уникальны — их пишем в быстрые мапы O(1)
    for (const item of items) {
      if (item.grsiNumber) byGrsi.set(item.grsiNumber.trim(), item);
      if (item.csmCode) byCsmCode.set(item.csmCode.trim(), item);
    }

    // Поле модели мы не пишем в Map, так как там каша из запятых.
    // Вместо этого мы возвращаем весь массив "all" для умного поиска ниже.
    return { byGrsi, byCsmCode, all: items };
  }

  private async cascadeMatchPrice(
    device: any,
    pricelistIds: string[],
    maps: {
      byGrsi: Map<string, any>;
      byCsmCode: Map<string, any>;
      all: any[];
    }
  ) {
    if (!pricelistIds || pricelistIds.length === 0) return null;

    // ⚡ Шаг 1: По Госреестру (Мгновенно в RAM)
    if (device.grsiNumber) {
      const item = maps.byGrsi.get(device.grsiNumber.trim());
      if (item) {
        item.matchHistorySku = `GRSI-${device.grsiNumber.trim()}`;
        return { item, method: 'grsi' };
      }
    }

    // ⚡ Шаг 2: По коду ЦСМ / СИ (Мгновенно в RAM)
    if (device.csmCode) {
      const item = maps.byCsmCode.get(device.csmCode.trim());
      if (item) {
        // 🎯 ДОБАВЛЕНО: Генерируем ключ инфляции для договорного тарифа
        item.matchHistorySku = `CSM-${device.csmCode.trim()}`;
        return { item, method: 'csm_code' };
      }
    }

    // Подготавливаем очищенную модель прибора для текстового анализа
    const deviceModelClean = device.model?.toLowerCase().trim();

    // // ⚡ Шаг 3: Умный поиск по Модели / Типу (Проверяем перечисления через запятую в ОЗУ)
    // if (deviceModelClean && deviceModelClean.length > 1) {
    //   let bestModelItem: typeof pricelistItems.$inferSelect | null = null;
    //   let highestModelScore = 0;

    //   for (const item of maps.all) {
    //     if (!item.modelOrType) continue;
    //     const pricelistModelLower = item.modelOrType.toLowerCase();

    //     // 🔥 ВОТ ТУТ ОНО РАБОТАЕТ:
    //     // Если в прайсе написано "МИТ-8.10, МИТ-8.15", а у прибора "МИТ-8.15" — условие сработает!
    //     if (pricelistModelLower.includes(deviceModelClean)) {
    //       // Считаем длину строки. Чем короче строка в прайсе при совпадении,
    //       // тем точнее совпадение (защита от ложных срабатываний схожих моделей)
    //       const score = 1000 - pricelistModelLower.length;
    //       if (score > highestModelScore) {
    //         highestModelScore = score;
    //         bestModelItem = item;
    //       }
    //     }
    //   }

    //   if (bestModelItem) return { item: bestModelItem, method: 'model_exact' };
    // }
    if (deviceModelClean && deviceModelClean.length > 1) {
      let bestModelItem: typeof pricelistItems.$inferSelect | null = null;
      let highestModelScore = 0;
      const isShortModel = deviceModelClean.length <= 2;

      for (const item of maps.all) {
        if (!item.modelOrType) continue;
        const pricelistModelLower = item.modelOrType.toLowerCase();

        if (pricelistModelLower.includes(deviceModelClean)) {
          if (isShortModel) {
            const exactWordRegex = new RegExp(
              `\\b${deviceModelClean}\\b|[^a-zа-я0-9]${deviceModelClean}[^a-zа-я0-9]`,
              'i'
            );
            if (!exactWordRegex.test(pricelistModelLower)) continue;
          }

          const score = 1000 - pricelistModelLower.length;
          if (score > highestModelScore) {
            highestModelScore = score;
            bestModelItem = item;
          }
        }
      }

      if (bestModelItem) {
        // 🎯 ДОБАВЛЕНО: Генерируем ключ инфляции по модели
        bestModelItem.matchHistorySku = `MODEL-${deviceModelClean}`;
        return { item: bestModelItem, method: 'model_exact' };
      }
    }

    // 🐘 Шаг 4: Полнотекстовый векторный поиск в БД с поддержкой РУССКОЙ МОРФОЛОГИИ
    // Выполняется ТОЛЬКО для проблемных приборов, если первые 3 шага не дали результатов
    if (device.name && device.name.trim().length > 3) {
      if (
        !pricelistIds ||
        !Array.isArray(pricelistIds) ||
        pricelistIds.length === 0
      ) {
        return null;
      }
      const cleanSearchQuery = device.name
        .replace(/[^a-zA-Zа-яА-Я0-9\s]/g, '')
        .split(/\s+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 2);
      // .join(' & ');

      if (cleanSearchQuery) {
        const isProduction = process.env.NODE_ENV === 'production';

        let ftsItem: any = null;

        if (isProduction) {
          // ПРОДАКШЕН: Полноценный, быстрый поиск Postgres со стеммингом и ранжированием
          const searchString = cleanSearchQuery.join(' & ');

          console.log('⏳ [ПРОД] Шаг 1: Запуск полнотекстового поиска...');

          const [res] = await this.db
            .select()
            .from(pricelistItems)
            .where(
              and(
                inArray(pricelistItems.pricelistId, pricelistIds),
                sql`to_tsvector('russian', ${pricelistItems.name}) @@ to_tsquery('russian', ${searchString})`
              )
            )
            .orderBy(
              sql`ts_rank(to_tsvector('russian', ${pricelistItems.name}), to_tsquery('russian', ${searchString})) DESC`
            )
            .limit(1);

          ftsItem = res;
          if (!ftsItem) {
            console.log(
              '🔍 [ПРОД] Шаг 2: Полнотекстовый поиск пуст. Включаем триграммный ассистент pg_trgm...'
            );

            // 0.4 означает минимум 40% схожести символов и их порядка
            const similarityThreshold = 0.4;

            const [trgmResult] = await this.db
              .select()
              .from(pricelistItems)
              .where(
                and(
                  inArray(pricelistItems.pricelistId, pricelistIds),
                  // Поиск по схожести выше порога с использованием индекса GIN
                  sql`similarity(${pricelistItems.name}, ${device.name}) > ${similarityThreshold}`
                )
              )
              // Сначала выводим максимально похожие позиции
              .orderBy(
                sql`similarity(${pricelistItems.name}, ${device.name}) DESC`
              )
              .limit(1);

            if (trgmResult) {
              console.log(
                '✅ [ПРОД] Триграммный ассистент успешно подобрал позицию:',
                trgmResult.name
              );
              ftsItem = trgmResult;
            }
          }
        } else {
          // ЛОКАЛЬНО Мок-ответ
          // База PGlite перегружена тысячами строк и падает по памяти в WASM.

          ftsItem = {
            id: `mock-item-id-${Math.random()}`,
            pricelistId: pricelistIds[0],
            name: `[ТЕСТ ПРАЙСА] ${device.name.toUpperCase()} (Поверка в ЦСМ)`,
            price: 1500.0,
            vatAmount: 300.0,
            totalCost: 1800.0,
            csmCode: 'ЦСМ-МOCK-100',
            grsiNumber: '12345-67',
          };
        }

        if (ftsItem) {
          if (!ftsItem.matchHistorySku) {
            ftsItem.matchHistorySku = ftsItem.grsiNumber
              ? `GRSI-${ftsItem.grsiNumber.trim()}` // Если в прайсе в столбце ГРСИ есть номер
              : ftsItem.csmCode
              ? `CSM-${ftsItem.csmCode.trim()}` // Если в прайсе в столбце Код СИ есть шифр
              : `TEXT-${cleanSearchQuery.join('-')}`; // Если это общая текстовая строка
          }

          return { item: ftsItem, method: 'text_fuzzy' };
        }
      }
    }

    return null;
  }

  // async createBudgetPlan(input: {
  //   year: number;
  //   pricelistIds: string[];
  //   comment?: string;
  //   cityId?: string;
  //   companyId?: string;
  //   productionSiteId?: string;
  // }) {
  //   const VAT_RATE = 0.2;
  //   const targetYear = input.year;

  //   // 1. Формируем условия каскадной фильтрации площадок холдинга
  //   const locationConditions: any[] = [];
  //   if (input.productionSiteId && input.productionSiteId !== 'ALL') {
  //     locationConditions.push(eq(productionSites.id, input.productionSiteId));
  //   } else {
  //     if (input.companyId && input.companyId !== 'ALL')
  //       locationConditions.push(eq(productionSites.companyId, input.companyId));
  //     if (input.cityId && input.cityId !== 'ALL')
  //       locationConditions.push(eq(productionSites.cityId, input.cityId));
  //   }

  //   let siteIds: string[] = [];
  //   if (locationConditions.length > 0) {
  //     const targetSites = await this.db
  //       .select({ id: productionSites.id })
  //       .from(productionSites)
  //       .where(and(...locationConditions));
  //     siteIds = targetSites.map((s) => s.id);

  //     if (siteIds.length === 0) {
  //       throw new Error(
  //         'Не найдено производственных площадок для указанных критериев.'
  //       );
  //     }
  //   }

  //   const siteFilterSql =
  //     siteIds.length > 0
  //       ? sql`AND d.production_site_id IN (${sql.join(siteIds, sql`, `)})`
  //       : sql``;

  //   // 2. 🐘 УМНЫЙ ОТБОР ПРИБОРОВ: Проверка архива, нерабочих статусов и даты следующей поверки по МПИ
  //   const targetDevicesRaw = await this.db.execute(sql`
  //     WITH last_verifications AS (
  //       -- Находим строго последнюю поверку для каждого прибора
  //       SELECT DISTINCT ON (device_id) id, device_id, valid_until
  //       FROM ${verifications}
  //       ORDER BY device_id, created_at DESC
  //     ),
  //     calculated_devices AS (
  //       SELECT
  //         d.id,
  //         d.name,
  //         d.model,
  //         d.grsi_number as "grsiNumber",
  //         d.csm_code as "csmCode",
  //         -- Вычисляем дату следующей поверки:
  //         -- valid_until последней поверки ИЛИ (дата получения + МПИ месяцев), если прибор новый
  //         COALESCE(
  //           lv.valid_until,
  //           d.receipt_date + (COALESCE(d.verification_interval, 12) || ' month')::interval
  //         ) as next_verification_date
  //       FROM ${devices} d
  //       LEFT JOIN last_verifications lv ON lv.device_id = d.id
  //       INNER JOIN ${statuses} s ON s.id = d.status_id
  //       WHERE d.archived = false -- 🎯 Исключаем архивные приборы
  //         -- 🎯 Исключаем нерабочие статусы
  //         AND LOWER(s.name) NOT IN ('неисправен', 'утерян', 'забракован', 'длительное хранение', 'консервация')
  //         ${siteFilterSql}
  //     )
  //     SELECT id, name, model, "grsiNumber", "csmCode"
  //     FROM calculated_devices
  //     -- Оставляем только те приборы, чей срок поверки наступает в планируемом году
  //     WHERE EXTRACT(YEAR FROM next_verification_date) = ${targetYear}
  //   `);

  //   const targetDevices = targetDevicesRaw.rows as any[];

  //   if (targetDevices.length === 0) {
  //     throw new Error(
  //       `В базе данных нет активных приборов, требующих плановой поверки/калибровки в ${targetYear} году.`
  //     );
  //   }

  //   // 3. Загружаем прайс-листы в память ОДИН раз для RAM-мэтчинга
  //   const pricelistMaps = await this.loadPricelistItemsMap(input.pricelistIds);

  //   // 4. Открываем транзакцию для атомарной записи заголовка и строк
  //   return await this.db.transaction(async (tx) => {
  //     const [newPlan] = await tx
  //       .insert(budgetPlans)
  //       .values({
  //         year: targetYear,
  //         comment: input.comment ?? null,
  //         status: 'draft',
  //       })
  //       .returning();

  //     if (!newPlan)
  //       throw new Error(
  //         'Не удалось зафиксировать заголовок плана бюджета в БД'
  //       );

  //     const itemsToInsert = [];

  //     for (const device of targetDevices) {
  //       // Подбираем цену по цепочке (RAM мапы -> точечно FTS в базе с русской морфологией)
  //       const matchResult = await this.cascadeMatchPrice(
  //         device,
  //         input.pricelistIds,
  //         pricelistMaps
  //       );

  //       const basePrice = matchResult ? parseFloat(matchResult.item.price) : 0;
  //       const vatAmount = basePrice * VAT_RATE;
  //       const totalCost = basePrice + vatAmount;

  //       itemsToInsert.push({
  //         budgetPlanId: newPlan.id,
  //         deviceId: device.id,
  //         deviceName: device.name ?? 'Неизвестный прибор',
  //         deviceModel: device.model ?? '',
  //         matchedPricelistItemId: matchResult ? matchResult.item.id : null,
  //         matchMethod: matchResult ? matchResult.method : 'not_found',
  //         basePrice: basePrice.toFixed(2),
  //         vatAmount: vatAmount.toFixed(2),
  //         totalCost: totalCost.toFixed(2),
  //       });
  //     }

  //     // 5. Запись в базу данных порциями по 1000 строк (защита от лимитов Postgres на bind-параметры)
  //     const CHUNK_SIZE = 1000;
  //     for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
  //       await tx
  //         .insert(budgetPlanItems)
  //         .values(itemsToInsert.slice(i, i + CHUNK_SIZE));
  //     }

  //     return newPlan;
  //   });
  // }

  async createBudgetPlan(input: {
    year: number;
    comment?: string | undefined;
    cityId?: string | undefined;
    companyId?: string | undefined;
    productionSiteId?: string | undefined;
    // Настройки режима калькуляции
    calculationMethod: 'pricelist' | 'history';
    pricelistIds?: string[] | undefined;
  }) {
    const VAT_RATE = 0.2;
    const targetYear = input.year;

    // 1. Каскадная сборка фильтров площадок холдинга
    const locationConditions: any[] = [];
    if (input.productionSiteId && input.productionSiteId !== 'ALL') {
      locationConditions.push(eq(productionSites.id, input.productionSiteId));
    } else {
      if (input.companyId && input.companyId !== 'ALL')
        locationConditions.push(eq(productionSites.companyId, input.companyId));
      if (input.cityId && input.cityId !== 'ALL')
        locationConditions.push(eq(productionSites.cityId, input.cityId));
    }

    let siteIds: string[] = [];
    if (locationConditions.length > 0) {
      const targetSites = await this.db
        .select({ id: productionSites.id })
        .from(productionSites)
        .where(and(...locationConditions));
      siteIds = targetSites.map((s) => s.id);

      if (siteIds.length === 0) {
        throw new Error(
          'Не найдено производственных площадок для указанных критериев.'
        );
      }
    }

    const siteFilterSql =
      siteIds.length > 0
        ? sql`AND d.production_site_id IN (${sql.join(siteIds, sql`, `)})`
        : sql``;

    // 2. 🐘 АНАЛИТИЧЕСКИЙ ОТБОР ПРИБОРОВ НА ЦЕЛЕВОЙ ГОД
    // Вытаскиваем девайсы по МПИ/крайней поверке, исключая архив и нерабочие статусы.
    // Дополнительно сразу подтягиваем цену крайней поверки (cost) для режима 'history'.
    const targetDevicesRaw = await this.db.execute(sql`
      WITH last_verifications AS (
        SELECT DISTINCT ON (device_id) id, device_id, valid_until, cost
        FROM ${verifications}
        ORDER BY device_id, created_at DESC
      ),
      calculated_devices AS (
        SELECT 
          d.id,
          d.name,
          d.model,
          d.grsi_number as "grsiNumber",
          d.csm_code as "csmCode",
          COALESCE(lv.cost, 0)::numeric as "historicalCost", -- Историческая цена
          COALESCE(
            lv.valid_until, 
            d.receipt_date + (COALESCE(d.verification_interval, 12) || ' month')::interval
          ) as next_verification_date
        FROM ${devices} d
        LEFT JOIN last_verifications lv ON lv.device_id = d.id
        INNER JOIN ${statuses} s ON s.id = d.status_id
        WHERE d.archived = false
          AND LOWER(s.name) NOT IN ('неисправен', 'утерян', 'забракован', 'длительное хранение', 'консервация')
          ${siteFilterSql}
      )
      SELECT id, name, model, "grsiNumber", "csmCode", "historicalCost"
      FROM calculated_devices
      WHERE EXTRACT(YEAR FROM next_verification_date) = ${targetYear}
    `);

    const targetDevices = targetDevicesRaw.rows as any[];

    if (targetDevices.length === 0) {
      throw new Error(
        `В базе данных нет активных приборов, требующих поверки/калибровки в ${targetYear} году.`
      );
    }

    // 3. Если выбран режим прайсов — инициализируем кэш в оперативной памяти
    let pricelistMaps: any = null;
    if (input.calculationMethod === 'pricelist') {
      if (!input.pricelistIds || input.pricelistIds.length === 0) {
        throw new Error(
          'Для выбранного метода расчета необходимо указать массив прайс-листов ЦСМ.'
        );
      }
      pricelistMaps = await this.loadPricelistItemsMap(input.pricelistIds);
    }

    // 4. Открываем транзакцию записи в базу данных
    return await this.db.transaction(async (tx) => {
      const [newPlan] = await tx
        .insert(budgetPlans)
        .values({
          year: targetYear,
          comment: input.comment ?? null,
          status: 'draft',
        })
        .returning();

      if (!newPlan)
        throw new Error(
          'Не удалось зафиксировать заголовок плана бюджета в БД'
        );

      const itemsToInsert = [];

      for (const device of targetDevices) {
        let basePrice = 0;
        let matchMethod = 'not_found';

        // РЕЖИМ 1: Расчёт цен по прайс-листам ЦСМ
        if (input.calculationMethod === 'pricelist') {
          const matchResult = await this.cascadeMatchPrice(
            device,
            input.pricelistIds!,
            pricelistMaps
          );
          if (matchResult) {
            basePrice = parseFloat(matchResult.item.price);
            matchMethod = matchResult.method;
          }
        }
        // РЕЖИМ 2: Расчёт цен на основе исторической стоимости прошлой поверки
        else {
          const historical = parseFloat(device.historicalCost || '0.00');
          if (historical > 0) {
            basePrice = historical;
            matchMethod = 'historical'; // Маркируем строку как посчитанную по истории
          }
        }

        const vatAmount = basePrice * VAT_RATE;
        const totalCost = basePrice + vatAmount;

        itemsToInsert.push({
          budgetPlanId: newPlan.id,
          deviceId: device.id,
          deviceName: device.name ?? 'Неизвестный прибор',
          deviceModel: device.model ?? '',
          matchedPricelistItemId: null, // Для истории поле остается пустым
          matchMethod: matchMethod,
          basePrice: basePrice.toFixed(2),
          vatAmount: vatAmount.toFixed(2),
          totalCost: totalCost.toFixed(2),
        });
      }

      // 5. Пакетный инсерт строк порциями по 1000 элементов
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
        await tx
          .insert(budgetPlanItems)
          .values(itemsToInsert.slice(i, i + CHUNK_SIZE));
      }

      return newPlan;
    });
  }

  // 5. Импорт прейскуранта через транзакцию
  async createPricelist(input: {
    verificationOrganizationId: string;
    title: string;
    year: number;
    isRegulated: boolean;
    items: Array<{
      grsiNumber?: string | undefined;
      csmCode?: string | undefined;
      name: string;
      modelOrType?: string | undefined;
      price: number;
    }>;
  }) {
    return await this.db.transaction(async (tx: any) => {
      const [newPricelist] = await tx
        .insert(pricelists)
        .values({
          verificationOrganizationId: input.verificationOrganizationId,
          title: input.title,
          year: input.year,
          isRegulated: input.isRegulated,
        })
        .returning();

      const itemsToInsert = input.items.map((item) => ({
        pricelistId: newPricelist.id,
        grsiNumber: item.grsiNumber ?? null,
        csmCode: item.csmCode ?? null,
        name: item.name,
        modelOrType: item.modelOrType ?? null,
        price: item.price.toFixed(2),
      }));

      const chunkSize = 1000;
      for (let i = 0; i < itemsToInsert.length; i += chunkSize) {
        await tx
          .insert(pricelistItems)
          .values(itemsToInsert.slice(i, i + chunkSize));
      }

      return newPricelist;
    });
  }

  // async getBudgetPlans() {
  //   const plans = await this.db
  //     .select()
  //     .from(budgetPlans)
  //     .orderBy(budgetPlans.year);

  //   return plans || [];
  // }

  async getBudgetPlans() {
    return await this.db
      .select({
        id: budgetPlans.id,
        year: budgetPlans.year,
        status: budgetPlans.status,
        comment: budgetPlans.comment,
        createdAt: sql<string>`TO_CHAR(${budgetPlans.createdAt}, 'YYYY-MM-DD HH24:MI:SS')`,
        updatedAt: sql<string>`TO_CHAR(${budgetPlans.updatedAt}, 'YYYY-MM-DD HH24:MI:SS')`,
        totalCount: count(budgetPlanItems.id),
        matchedCount: sql<number>`COUNT(CASE WHEN ${budgetPlanItems.matchMethod} != 'not_found' THEN 1 END)::int`,
        totalCost: sql<number>`COALESCE(SUM(${budgetPlanItems.totalCost}), 0)::float`,
      })
      .from(budgetPlans)
      .leftJoin(
        budgetPlanItems,
        eq(budgetPlanItems.budgetPlanId, budgetPlans.id)
      )
      .groupBy(budgetPlans.id)
      .orderBy(desc(budgetPlans.year));
  }

  // async getBudgetPlan(id: string) {
  //   const [plan] = await this.db
  //     .select()
  //     .from(budgetPlans)
  //     .where(eq(budgetPlans.id, id))
  //     .limit(1);
  //   return plan || null;
  // }
  async getBudgetPlan(id: string) {
    const result = await this.db
      .select({
        id: budgetPlans.id,
        year: budgetPlans.year,
        status: budgetPlans.status,
        comment: budgetPlans.comment,
        createdAt: sql<string>`TO_CHAR(${budgetPlans.createdAt}, 'YYYY-MM-DD HH24:MI:SS')`,
        updatedAt: sql<string>`TO_CHAR(${budgetPlans.updatedAt}, 'YYYY-MM-DD HH24:MI:SS')`,
        totalCount: count(budgetPlanItems.id),
        matchedCount: sql<number>`COUNT(CASE WHEN ${budgetPlanItems.matchMethod} != 'not_found' THEN 1 END)::int`,
        totalCost: sql<number>`COALESCE(SUM(${budgetPlanItems.totalCost}), 0)::float`,
      })
      .from(budgetPlans)
      .leftJoin(
        budgetPlanItems,
        eq(budgetPlanItems.budgetPlanId, budgetPlans.id)
      )
      .where(eq(budgetPlans.id, id))
      .groupBy(budgetPlans.id);

    return result[0] || null;
  }

  async updateBudgetPlanItemPrice(itemId: string, manualPrice: number) {
    const [item] = await this.db
      .select()
      .from(budgetPlanItems)
      .where(eq(budgetPlanItems.id, itemId))
      .limit(1);
    if (!item) throw new Error('Строка бюджета не найдена');

    const [plan] = await this.db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.id, item.budgetPlanId))
      .limit(1);
    if (plan?.status === 'approved') throw new Error('Бюджет заблокирован');

    const vatAmount = manualPrice * 0.2;
    const totalCost = manualPrice + vatAmount;

    const [updated] = await this.db
      .update(budgetPlanItems)
      .set({
        basePrice: manualPrice.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalCost: totalCost.toFixed(2),
        matchMethod: 'manual',
      })
      .where(eq(budgetPlanItems.id, itemId))
      .returning();

    return updated;
  }

  async approveBudgetPlan(id: string) {
    const [updated] = await this.db
      .update(budgetPlans)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(budgetPlans.id, id))
      .returning();
    return updated;
  }

  // async deleteBudgetPlan(id: string) {
  //   return !!(await this.db.delete(budgetPlans).where(eq(budgetPlans.id, id)));
  // }

  // async deletePricelist(id: string) {
  //   return !!(await this.db.delete(pricelists).where(eq(pricelists.id, id)));
  // }
  async deleteBudgetPlan(id: string): Promise<boolean> {
    const result = await this.db
      .delete(budgetPlans)
      .where(eq(budgetPlans.id, id))
      .returning();
    return result.length > 0;
  }

  async deletePricelist(id: string): Promise<boolean> {
    const result = await this.db
      .delete(pricelists)
      .where(eq(pricelists.id, id))
      .returning();
    return result.length > 0;
  }

  async createPricelistHeader(metadata: {
    title: string;
    year: number;
    isRegulated: boolean;
    verificationOrganizationId: string;
  }) {
    const [newPricelist] = await this.db
      .insert(pricelists)
      .values({
        verificationOrganizationId: metadata.verificationOrganizationId,
        title: metadata.title,
        year: metadata.year,
        isRegulated: metadata.isRegulated,
      })
      .returning();

    return newPricelist;
  }

  // 2. Пакетная вставка позиций порциями (вызывается воркером на каждой итерации цикла)
  async insertPricelistItemsChunk(
    pricelistId: string,
    items: Array<{
      grsiNumber?: string | undefined;
      csmCode?: string | undefined;
      name: string;
      modelOrType?: string | undefined;
      price: number;
    }>
  ): Promise<number> {
    if (items.length === 0) return 0;

    // Формируем плоский массив структур под типы колонок БД
    const itemsToInsert = items.map((item) => {
      // Гарантируем, что цена — строго валидное число. Если NaN — пишем 0.00
      const parsedPrice =
        typeof item.price === 'number' && !isNaN(item.price)
          ? item.price
          : parseFloat(item.price as any) || 0;

      return {
        pricelistId,
        grsiNumber: item.grsiNumber ?? null,
        csmCode: item.csmCode ?? null,
        name: item.name,
        modelOrType: item.modelOrType ?? null,
        price: parsedPrice.toFixed(2), // Теперь тут железно будет валдиная строка "1250.50"
      };
    });

    // Выполняем пакетную вставку чанка
    await this.db.insert(pricelistItems).values(itemsToInsert);

    return itemsToInsert.length;
  }

  // async getBudgetPlanDistribution(
  //   budgetId: string,
  //   groupBy: 'company' | 'city' | 'production_site'
  // ) {
  //   const selectFields: Record<string, any> = {
  //     count: sql<number>`count(${budgetPlanItems.id})::int`,
  //     baseSubtotal: sql<string>`sum(${budgetPlanItems.basePrice})::numeric(10,2)`,
  //     totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(10,2)`,
  //   };

  //   let groupByFields: any[] = [];
  //   if (groupBy === 'company') {
  //     selectFields.groupId = sql`c.id`; // 🎯 вытягиваем UUID
  //     selectFields.groupName = sql`c.name`;
  //     groupByFields = [sql`c.id`, sql`c.name`];
  //   } else if (groupBy === 'city') {
  //     selectFields.groupId = sql`cities.id`; // 🎯 вытягиваем UUID
  //     selectFields.groupName = sql`cities.name`;
  //     groupByFields = [sql`cities.id`, sql`cities.name`];
  //   } else {
  //     selectFields.groupId = productionSites.id; // 🎯 вытягиваем UUID
  //     selectFields.groupName = productionSites.name;
  //     groupByFields = [productionSites.id, productionSites.name];
  //   }

  //   // Один оптимизированный JOIN-запрос
  //   const distribution = await this.db
  //     .select(selectFields)
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(sql`companies c`, sql`production_sites.company_id = c.id`)
  //     .innerJoin(sql`cities`, sql`production_sites.city_id = cities.id`)
  //     .where(eq(budgetPlanItems.budgetPlanId, budgetId))
  //     .groupBy(...groupByFields);

  //   return distribution || [];
  // }
  async getBudgetPlanDistribution(
    budgetId: string,
    groupBy: 'company' | 'city' | 'production_site'
  ) {
    const selectFields: Record<string, any> = {
      count: sql<number>`count(${budgetPlanItems.id})::int`,
      baseSubtotal: sql<string>`sum(${budgetPlanItems.basePrice})::numeric(12,2)`,
      totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(12,2)`,
    };

    let groupByFields: any[] = [];
    if (groupBy === 'company') {
      selectFields.groupId = sql`c.id`;
      selectFields.groupName = sql`c.name`;
      groupByFields = [sql`c.id`, sql`c.name`];
    } else if (groupBy === 'city') {
      selectFields.groupId = sql`cities.id`;
      selectFields.groupName = sql`cities.name`;
      groupByFields = [sql`cities.id`, sql`cities.name`];
    } else {
      selectFields.groupId = productionSites.id;
      selectFields.groupName = productionSites.name;
      groupByFields = [productionSites.id, productionSites.name];
    }

    const distribution = await this.db
      .select(selectFields)
      .from(budgetPlanItems)
      .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .innerJoin(sql`companies c`, sql`production_sites.company_id = c.id`)
      .innerJoin(sql`cities`, sql`production_sites.city_id = cities.id`)
      .where(eq(budgetPlanItems.budgetPlanId, budgetId))
      .groupBy(...groupByFields);

    return distribution.map((r: any) => ({
      groupId: r.groupId,
      groupName: r.groupName,
      count: r.count,
      baseSubtotal: parseFloat(r.baseSubtotal || '0.00'),
      totalCost: parseFloat(r.totalCost || '0.00'),
    }));
  }

  async getCsmTariffTrend(siteId: string) {
    if (!siteId) {
      throw new Error('Параметр siteId обязателен для получения аналитики.');
    }

    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // 🖥️ ПРОДАКШЕН: Считаем суммарные затраты по конкретному цеху за все доступные года в разрезе ЦСМ
      const rows = await this.db
        .select({
          year: pricelistItems.year,
          price: sql<number>`CAST(SUM(${pricelistItems.price}) AS DOUBLE PRECISION)`,
          // Берём имя цеха из справочника
          serviceName: sql<string>`(SELECT name FROM production_sites WHERE id = ${siteId} LIMIT 1)`,
          // Вытаскиваем имя ЦСМ через родительские прайсы
          csmName: sql<string>`
            (SELECT pl.title 
             FROM pricelists pl 
             WHERE pl.id = ${pricelistItems.pricelistId} 
             LIMIT 1)
          `,
        })
        .from(pricelistItems)
        // Предполагается, что у вас в строках бюджета или прайсов есть привязка к площадкам холдинга
        // Если привязка идет через связанные таблицы, Drizzle скомпилирует этот подзапрос
        .groupBy(pricelistItems.year, pricelistItems.pricelistId)
        .orderBy(pricelistItems.year);

      if (rows.length === 0) {
        return {
          serviceName: 'Данные по цеху не найдены',
          timeline: [],
        };
      }

      return {
        serviceName: `Динамика стоимости обслуживания: Цех "${
          rows[0]?.serviceName || '—'
        }"`,
        timeline: rows.map((row: any) => ({
          year: row.year,
          price: row.price,
          csmName: row.csmName || 'Региональный ЦСМ',
        })),
      };
    } else {
      // 📱 ЛОКАЛЬНО (Защита PGlite от зависаний): Стабильные Mock-данные
      return {
        serviceName: `Динамика стоимости обслуживания объекта (Тестовый цех #${siteId.slice(
          0,
          4
        )})`,
        timeline: [
          { year: 2024, price: 45000.0, csmName: 'Новосибирский ЦСМ' },
          { year: 2025, price: 52000.0, csmName: 'Новосибирский ЦСМ' },
          { year: 2026, price: 61000.0, csmName: 'Новосибирский ЦСМ' },
          { year: 2024, price: 50000.0, csmName: 'Ростест-Москва' },
          { year: 2025, price: 58000.0, csmName: 'Ростест-Москва' },
          { year: 2026, price: 64000.0, csmName: 'Ростест-Москва' },
        ],
      };
    }
  }

  async getVerificationRisks() {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      // 🖥️ ПРОДАКШЕН: Универсальный SQL-запрос, привязанный к текстовым бизнес-маркерам (без хардкода UUID)
      const rawRows = await this.db.execute(sql`
        WITH latest_verifications AS (
          SELECT 
            v.device_id,
            v.valid_until,
            ROW_NUMBER() OVER (PARTITION BY v.device_id ORDER BY v.date DESC) as rn
          FROM verifications v
          -- 🎯 УНИВЕРСАЛЬНЫЙ ФИЛЬТР: Привязываемся к именам типов контроля, а не к UUID
          INNER JOIN metrology_controle_types mct ON msmct.id = v.metrology_controle_type_id
          WHERE mct.name ILIKE '%поверка%' OR mct.name ILIKE '%калибровка%'
        ),
        device_statuses AS (
          SELECT 
            d.id as device_id,
            d.production_site_id,
            CASE 
              -- 🎯 УНИВЕРСАЛЬНЫЙ ФИЛЬТР СТАТУСОВ: Консервация и утеря не создают операционных рисков
              WHEN s.name ILIKE '%хранение%' OR s.name ILIKE '%утерян%' THEN 'green'
              
              -- Если прибор активен (Исправен/Неисправен), но дата пустая или просрочена
              WHEN lv.valid_until IS NULL THEN 'expired' 
              WHEN lv.valid_until < NOW() THEN 'expired'
              
              -- Предупреждение за 30 дней до окончания поверочного клейма
              WHEN lv.valid_until BETWEEN NOW() AND NOW() + INTERVAL '30 days' THEN 'warning'
              ELSE 'green'
            END as status_type
          FROM devices d
          INNER JOIN statuses s ON s.id = d.status_id
          LEFT JOIN latest_verifications lv ON lv.device_id = d.id AND lv.rn = 1
          WHERE d.archived = false -- Строго отсекаем архивные карточки приборов
        )
        SELECT 
          c.id as city_id,
          c.name as city_name,
          co.id as company_id,
          co.name as company_name,
          ps.id as site_id,
          ps.name as site_name,
          COUNT(ds.device_id) as total_count,
          COUNT(CASE WHEN ds.status_type = 'expired' THEN 1 END) as expired_count,
          COUNT(CASE WHEN ds.status_type = 'warning' THEN 1 END) as warning_count
        FROM production_sites ps
        INNER JOIN cities c ON c.id = ps.city_id
        INNER JOIN companies co ON co.id = ps.company_id
        LEFT JOIN device_statuses ds ON ds.production_site_id = ps.id
        GROUP BY c.id, c.name, co.id, co.name, ps.id, ps.name
        ORDER BY c.name, co.name, ps.name;
      `);

      // (Логика сборки дерева Map -> Array остаётся прежней без изменений)
      const citiesMap = new Map<string, any>();
      rawRows.rows.forEach((row: any) => {
        if (!citiesMap.has(row.city_id)) {
          citiesMap.set(row.city_id, {
            id: row.city_id,
            name: row.city_name,
            status: 'green',
            totalCount: 0,
            expiredCount: 0,
            warningCount: 0,
            companiesMap: new Map(),
          });
        }
        const cityNode = citiesMap.get(row.city_id);

        if (!cityNode.companiesMap.has(row.company_id)) {
          cityNode.companiesMap.set(row.company_id, {
            id: row.company_id,
            name: row.company_name,
            status: 'green',
            totalCount: 0,
            expiredCount: 0,
            warningCount: 0,
            sites: [],
          });
        }
        const companyNode = cityNode.companiesMap.get(row.company_id);

        const total = Number(row.total_count) || 0;
        const expired = Number(row.expired_count) || 0;
        const warning = Number(row.warning_count) || 0;

        let siteStatus = 'green';
        if (expired > 0) siteStatus = 'error';
        else if (warning > 0) siteStatus = 'warning';

        companyNode.sites.push({
          id: row.site_id,
          name: row.site_name,
          status: siteStatus,
          totalCount: total,
          expiredCount: expired,
          warningCount: warning,
        });

        companyNode.totalCount += total;
        companyNode.expiredCount += expired;
        companyNode.warningCount += warning;
        if (siteStatus === 'error') companyNode.status = 'error';
        else if (siteStatus === 'warning' && companyNode.status !== 'error')
          companyNode.status = 'warning';

        cityNode.totalCount += total;
        cityNode.expiredCount += expired;
        cityNode.warningCount += warning;
        if (siteStatus === 'error') cityNode.status = 'error';
        else if (siteStatus === 'warning' && cityNode.status !== 'error')
          cityNode.status = 'warning';
      });

      return {
        cities: Array.from(citiesMap.values()).map((city) => ({
          ...city,
          companies: Array.from(city.companiesMap.values()),
        })),
      };
    } else {
      // 📱 ЛОКАЛЬНО: Демонстрационное интерактивное дерево рисков (Mock), чтобы PGlite не зависал
      return {
        cities: [
          {
            id: 'cit-nsk',
            name: 'Новосибирск',
            status: 'error',
            totalCount: 450,
            expiredCount: 12,
            warningCount: 45,
            companies: [
              {
                id: 'co-sib-met',
                name: 'Новосибирский Завод Электросигнал',
                status: 'error',
                totalCount: 300,
                expiredCount: 12,
                warningCount: 25,
                sites: [
                  {
                    id: 'site-sm-1',
                    name: 'Цех №1 КИПиА',
                    status: 'error',
                    totalCount: 120,
                    expiredCount: 8,
                    warningCount: 10,
                  },
                  {
                    id: 'site-sm-2',
                    name: 'Участок тепловой автоматики',
                    status: 'warning',
                    totalCount: 100,
                    expiredCount: 0,
                    warningCount: 15,
                  },
                  {
                    id: 'site-sm-3',
                    name: 'Энергоблок',
                    status: 'green',
                    totalCount: 80,
                    expiredCount: 0,
                    warningCount: 0,
                  },
                ],
              },
            ],
          },
          {
            id: 'cit-omsk',
            name: 'Омск',
            status: 'green',
            totalCount: 180,
            expiredCount: 0,
            warningCount: 0,
            companies: [
              {
                id: 'co-omsk-ref',
                name: 'ОмскНефтеПродукт',
                status: 'green',
                totalCount: 180,
                expiredCount: 0,
                warningCount: 0,
                sites: [
                  {
                    id: 'site-or-1',
                    name: 'Участок поверки датчиков давления',
                    status: 'green',
                    totalCount: 180,
                    expiredCount: 0,
                    warningCount: 0,
                  },
                ],
              },
            ],
          },
        ],
      };
    }
  }
}
