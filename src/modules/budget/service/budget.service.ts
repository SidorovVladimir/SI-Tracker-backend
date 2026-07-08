import {
  sql,
  and,
  eq,
  inArray,
  desc,
  ilike,
  count,
  or,
  isNull,
} from 'drizzle-orm';
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
import { equipmentTypes } from '../../catalog/models/equipmentType.model';

export class BudgetService {
  constructor(private db: DrizzleDB) {}

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
      const item = maps.byGrsi.get(device.grsiNumber.toLowerCase().trim());
      if (item) {
        item.matchHistorySku = `GRSI-${device.grsiNumber.toLowerCase().trim()}`;
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

    // // Подготавливаем очищенную модель прибора для текстового анализа
    // const deviceModelClean = device.model?.toLowerCase().trim();
    // if (deviceModelClean && deviceModelClean.length > 1) {
    //   let bestModelItem: typeof pricelistItems.$inferSelect | null = null;
    //   let highestModelScore = 0;
    //   const isShortModel = deviceModelClean.length <= 2;

    //   for (const item of maps.all) {
    //     if (!item.modelOrType) continue;
    //     const pricelistModelLower = item.modelOrType.toLowerCase();

    //     if (pricelistModelLower.includes(deviceModelClean)) {
    //       if (isShortModel) {
    //         const exactWordRegex = new RegExp(
    //           `\\b${deviceModelClean}\\b|[^a-zа-я0-9]${deviceModelClean}[^a-zа-я0-9]`,
    //           'i'
    //         );
    //         if (!exactWordRegex.test(pricelistModelLower)) continue;
    //       }

    //       const score = 1000 - pricelistModelLower.length;
    //       if (score > highestModelScore) {
    //         highestModelScore = score;
    //         bestModelItem = item;
    //       }
    //     }
    //   }

    //   if (bestModelItem) {
    //     // 🎯 ДОБАВЛЕНО: Генерируем ключ инфляции по модели
    //     bestModelItem.matchHistorySku = `MODEL-${deviceModelClean}`;
    //     return { item: bestModelItem, method: 'model_exact' };
    //   }
    // }

    // // 🐘 Шаг 4: Полнотекстовый векторный поиск в БД с поддержкой РУССКОЙ МОРФОЛОГИИ
    // // Выполняется ТОЛЬКО для проблемных приборов, если первые 3 шага не дали результатов
    // if (device.name && device.name.trim().length > 3) {
    //   if (
    //     !pricelistIds ||
    //     !Array.isArray(pricelistIds) ||
    //     pricelistIds.length === 0
    //   ) {
    //     return null;
    //   }
    //   const cleanSearchQuery = device.name
    //     .replace(/[^a-zA-Zа-яА-Я0-9\s]/g, '')
    //     .split(/\s+/)
    //     .map((w: string) => w.trim())
    //     .filter((w: string) => w.length > 2);
    //   // .join(' & ');

    //   if (cleanSearchQuery) {
    //     const isProduction = process.env.NODE_ENV === 'production';

    //     let ftsItem: any = null;

    //     if (isProduction) {
    //       // ПРОДАКШЕН: Полноценный, быстрый поиск Postgres со стеммингом и ранжированием
    //       const searchString = cleanSearchQuery.join(' & ');

    //       // console.log('⏳ [ПРОД] Шаг 1: Запуск полнотекстового поиска...');

    //       const [res] = await this.db
    //         .select()
    //         .from(pricelistItems)
    //         .where(
    //           and(
    //             inArray(pricelistItems.pricelistId, pricelistIds),
    //             sql`to_tsvector('russian', ${pricelistItems.name}) @@ to_tsquery('russian', ${searchString})`
    //           )
    //         )
    //         .orderBy(
    //           sql`ts_rank(to_tsvector('russian', ${pricelistItems.name}), to_tsquery('russian', ${searchString})) DESC`
    //         )
    //         .limit(1);

    //       ftsItem = res;
    //       if (!ftsItem) {
    //         // console.log(
    //         //   '🔍 [ПРОД] Шаг 2: Полнотекстовый поиск пуст. Включаем триграммный ассистент pg_trgm...'
    //         // );

    //         // 0.4 означает минимум 40% схожести символов и их порядка
    //         const similarityThreshold = 0.4;

    //         const [trgmResult] = await this.db
    //           .select()
    //           .from(pricelistItems)
    //           .where(
    //             and(
    //               inArray(pricelistItems.pricelistId, pricelistIds),
    //               // Поиск по схожести выше порога с использованием индекса GIN
    //               sql`similarity(${pricelistItems.name}, ${device.name}) > ${similarityThreshold}`
    //             )
    //           )
    //           // Сначала выводим максимально похожие позиции
    //           .orderBy(
    //             sql`similarity(${pricelistItems.name}, ${device.name}) DESC`
    //           )
    //           .limit(1);

    //         if (trgmResult) {
    //           // console.log(
    //           //   '✅ [ПРОД] Триграммный ассистент успешно подобрал позицию:',
    //           //   trgmResult.name
    //           // );
    //           ftsItem = trgmResult;
    //         }
    //       }
    //     } else {
    //       // ЛОКАЛЬНО Мок-ответ
    //       // База PGlite перегружена тысячами строк и падает по памяти в WASM.

    //       ftsItem = {
    //         id: `mock-item-id-${Math.random()}`,
    //         pricelistId: pricelistIds[0],
    //         name: `[ТЕСТ ПРАЙСА] ${device.name.toUpperCase()} (Поверка в ЦСМ)`,
    //         price: 1500.0,
    //         vatAmount: 300.0,
    //         totalCost: 1800.0,
    //         csmCode: 'ЦСМ-МOCK-100',
    //         grsiNumber: '12345-67',
    //       };
    //     }

    //     if (ftsItem) {
    //       if (!ftsItem.matchHistorySku) {
    //         ftsItem.matchHistorySku = ftsItem.grsiNumber
    //           ? `GRSI-${ftsItem.grsiNumber.trim()}` // Если в прайсе в столбце ГРСИ есть номер
    //           : ftsItem.csmCode
    //           ? `CSM-${ftsItem.csmCode.trim()}` // Если в прайсе в столбце Код СИ есть шифр
    //           : `TEXT-${cleanSearchQuery.join('-')}`; // Если это общая текстовая строка
    //       }

    //       return { item: ftsItem, method: 'text_fuzzy' };
    //     }
    //   }
    // }

    return null;
  }

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
        LEFT JOIN ${equipmentTypes} et ON et.id = d.equipment_type_id
        WHERE d.archived = false
          AND LOWER(s.name) NOT IN ('неисправен', 'утерян', 'забракован', 'длительное хранение', 'консервация')
          AND (
            d.equipment_type_id IS NULL
            OR LOWER(et.name) IN (
              'средство измерений (си)',
              'испытательное оборудование (ио)',
              'средство контроля (ск)'
            )
          )
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
      // name: string;
      // modelOrType?: string | undefined;
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
        grsiNumber: item.grsiNumber
          ? item.grsiNumber.toLowerCase().trim()
          : null,

        csmCode: item.csmCode ? item.csmCode.toLowerCase().trim() : null,
        // name: item.name,
        // modelOrType: item.modelOrType ?? null,
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
      // name: string;
      // modelOrType?: string | undefined;
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
        grsiNumber: item.grsiNumber
          ? item.grsiNumber.toLowerCase().trim()
          : null,

        csmCode: item.csmCode ? item.csmCode.toLowerCase().trim() : null,
        // name: item.name,
        // modelOrType: item.modelOrType ?? null,
        price: parsedPrice.toFixed(2), // Теперь тут железно будет валдиная строка "1250.50"
      };
    });

    // Выполняем пакетную вставку чанка
    await this.db.insert(pricelistItems).values(itemsToInsert);

    return itemsToInsert.length;
  }

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

  // async getCsmTariffTrend(idOrSku: string) {
  //   if (!idOrSku) {
  //     throw new Error('Параметр idOrSku обязателен для получения аналитики.');
  //   }

  //   const isUuid =
  //     /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
  //       idOrSku
  //     );

  //   if (isUuid) {
  //     // =========================================================================
  //     // СЦЕНАРИЙ А: Передан UUID цеха/площадки (Вызов с общего дашборда аналитики)
  //     // =========================================================================

  //     const rows = await this.db
  //       .select({
  //         year: pricelistItems.year,
  //         // Кастуем numeric цену в double precision для графиков на фронтенде
  //         price: sql<number>`SUM(${pricelistItems.price})::double precision`,
  //         csmName: pricelists.title, // 🌟 ИСПРАВЛЕНО: Прямая ссылка без подзапросов
  //         serviceName: productionSites.name, // 🌟 ИСПРАВЛЕНО: Прямая ссылка без подзапросов
  //       })
  //       .from(pricelistItems)
  //       .innerJoin(
  //         devices,
  //         and(
  //           eq(devices.productionSiteId, idOrSku),
  //           eq(devices.archived, false),
  //           or(
  //             eq(pricelistItems.grsiNumber, devices.grsiNumber),
  //             eq(pricelistItems.csmCode, devices.csmCode)
  //           )
  //         )
  //       )
  //       .leftJoin(
  //         equipmentTypes,
  //         eq(equipmentTypes.id, devices.equipmentTypeId)
  //       )
  //       .leftJoin(statuses, eq(statuses.id, devices.statusId))
  //       .leftJoin(pricelists, eq(pricelists.id, pricelistItems.pricelistId))
  //       .leftJoin(
  //         productionSites,
  //         eq(productionSites.id, devices.productionSiteId)
  //       )
  //       .where(
  //         and(
  //           eq(sql`lower(${statuses.name})`, 'исправен'),

  //           or(
  //             isNull(devices.equipmentTypeId),
  //             inArray(sql`lower(${equipmentTypes.name})`, [
  //               'средство измерений (си)',
  //               'испытательное оборудование (ио)',
  //               'средство контроля (ск)',
  //             ])
  //           )
  //         )
  //       )
  //       .groupBy(
  //         pricelistItems.year,
  //         pricelistItems.pricelistId,
  //         pricelists.title,
  //         productionSites.name
  //       )
  //       .orderBy(pricelistItems.year);

  //     if (!rows || rows.length === 0) {
  //       return { serviceName: 'Данные по цеху не найдены', timeline: [] };
  //     }

  //     const firstRow = rows[0];

  //     return {
  //       serviceName: `Динамика стоимости обслуживания: ${
  //         firstRow?.serviceName || 'Цех'
  //       }`,
  //       timeline: rows.map((row) => ({
  //         year: Number(row.year),
  //         price: Number(row.price),
  //         csmName: row.csmName || 'Региональный ЦСМ',
  //       })),
  //     };
  //   } else {
  //     // =========================================================================
  //     // СЦЕНАРИЙ Б: Передан текстовый SKU прибора (Вызов при клике в списке бюджета)
  //     // =========================================================================

  //     // Шаг 1: Пробуем найти по точному совпадению артикула matchHistorySku
  //     const rows = await this.db
  //       .select({
  //         year: pricelistItems.year,
  //         price: sql<number>`${pricelistItems.price}::double precision`,
  //         // serviceName: pricelistItems.name,
  //         csmName: pricelists.title,
  //       })
  //       .from(pricelistItems)
  //       .leftJoin(pricelists, eq(pricelists.id, pricelistItems.pricelistId)) // Добавили связь с заголовком
  //       .where(eq(pricelistItems.matchHistorySku, idOrSku))
  //       .orderBy(pricelistItems.year);

  //     // Шаг 2: Спасательный круг (Fallback) — если по SKU пусто, ищем текстовым поиском по названию позиции
  //     // if (!rows || rows.length === 0) {
  //     //   const cleanText = idOrSku.replace('TEXT-', '').replace(/-/g, ' ');

  //     //   rows = await this.db
  //     //     .select({
  //     //       year: pricelistItems.year,
  //     //       price: sql<number>`${pricelistItems.price}::double precision`,
  //     //       serviceName: pricelistItems.name,
  //     //       csmName: pricelists.title,
  //     //     })
  //     //     .from(pricelistItems)
  //     //     .leftJoin(pricelists, eq(pricelists.id, pricelistItems.pricelistId))
  //     //     .where(ilike(pricelistItems.name, `%${cleanText}%`))
  //     //     .orderBy(pricelistItems.year);

  //     //   if (!rows || rows.length === 0) {
  //     //     return {
  //     //       serviceName: `Анализ инфляции: "${cleanText}"`,
  //     //       timeline: [],
  //     //     };
  //     //   }
  //     // }

  //     if (!rows || rows.length === 0) {
  //       return {
  //         serviceName: 'История тарифов по данному СИ отсутствует',
  //         timeline: [],
  //       };
  //     }

  //     return {
  //       serviceName: `Анализ инфляции тарифа: ${idOrSku}`,
  //       timeline: rows.map((row) => ({
  //         year: Number(row.year),
  //         price: Number(row.price),
  //         csmName: row.csmName || 'Региональный ЦСМ',
  //       })),
  //     };

  //     // Забираем название услуги из самой свежей по году строки тарифа
  //     // const latestServiceName =
  //     //   rows[rows.length - 1]?.serviceName || 'Услуга поверки СИ';

  //     // return {
  //     //   serviceName: latestServiceName,
  //     //   timeline: rows.map((row) => ({
  //     //     year: Number(row.year),
  //     //     price: Number(row.price),
  //     //     csmName: row.csmName || 'Региональный ЦСМ',
  //     //   })),
  //     // };
  //   }
  // }

  async getCsmTariffTrend(idOrSku: string) {
    if (!idOrSku) {
      throw new Error(
        'Параметр idOrSku обязателен для анализа инфляции тарифов.'
      );
    }

    const isUuid =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
        idOrSku
      );

    if (isUuid) {
      // =========================================================================
      // СЦЕНАРИЙ А: Анализ роста тарифов ЦСМ по всему УЧАСТКУ (Цеху)
      // Считаем сумму ЕДИНИЧНЫХ расценок ЦСМ строго для планового парка СИ / ИО / СК
      // =========================================================================
      const rows = await this.db
        .select({
          year: pricelistItems.year,
          // Складываем базовые тарифы уникального платного оборудования цеха
          price: sql<number>`SUM(${pricelistItems.price})::double precision`,
        })
        .from(pricelistItems)
        .innerJoin(
          devices,
          and(
            eq(devices.productionSiteId, idOrSku),
            eq(devices.archived, false), // Исключаем архивные приборы
            or(
              eq(
                sql`lower(${pricelistItems.grsiNumber})`,
                sql`lower(${devices.grsiNumber})`
              ),
              eq(
                sql`lower(${pricelistItems.csmCode})`,
                sql`lower(${devices.csmCode})`
              )
            )
          )
        )
        // 🌟 ДОБАВЛЕНО: Подключаем типы оборудования для жесткой фильтрации
        .leftJoin(
          equipmentTypes,
          eq(equipmentTypes.id, devices.equipmentTypeId)
        )
        .leftJoin(statuses, eq(statuses.id, devices.statusId))
        .where(
          and(
            // График строится по работающим на линии исправным приборам
            eq(sql`lower(${statuses.name})`, 'исправен'),

            // 🔒 КАТАЛОЖНЫЙ ФИЛЬТР: Отсекаем бесплатные ВО и Индикаторы, защищая суммы от искажений
            or(
              isNull(devices.equipmentTypeId), // Страховка ручного ввода (СИ по умолчанию)
              inArray(sql`lower(${equipmentTypes.name})`, [
                'средство измерений (си)',
                'испытательное оборудование (ио)',
                'средство контроля (ск)',
              ])
            )
          )
        )
        .groupBy(pricelistItems.year)
        .orderBy(pricelistItems.year);

      return {
        serviceName: 'Индекс изменения тарифов ЦСМ по номенклатуре участка',
        timeline: rows.map((row) => ({
          year: Number(row.year),
          price: Number(row.price),
          csmName: 'Официальный прейскурант ЦСМ',
        })),
      };
    } else {
      // =========================================================================
      // СЦЕНАРИЙ Б: Анализ инфляции тарифа конкретного ПРИБОРА (По его SKU)
      // Показывает чистый рост цены за 1 шт. конкретной услуги по годам
      // =========================================================================
      const rows = await this.db
        .select({
          year: pricelistItems.year,
          price: sql<number>`${pricelistItems.price}::double precision`,
        })
        .from(pricelistItems)
        .where(
          and(
            // Бьем точно по вашему новому уникальному индексу сквозного артикула
            eq(
              sql`lower(${pricelistItems.matchHistorySku})`,
              idOrSku.toLowerCase().trim()
            ),
            sql`${pricelistItems.price} > 0`
          )
        )
        .orderBy(pricelistItems.year);

      return {
        serviceName: `Динамика стоимости 1 шт. СИ в ЦСМ: ${idOrSku.toUpperCase()}`,
        timeline: rows.map((row) => ({
          year: Number(row.year),
          price: Number(row.price),
          csmName: 'Тариф прейскуранта за единицу',
        })),
      };
    }
  }

  async getVerificationRisks() {
    // 1. ПОДЗАПРОС А: Находим дату самого свежего контроля для каждого прибора
    const latestDatesSub = this.db
      .select({
        deviceId: verifications.deviceId,
        maxDate: sql`MAX(${verifications.date})`.as('max_date'),
      })
      .from(verifications)
      .leftJoin(
        metrologyControleTypes,
        eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
      )
      .where(
        or(
          inArray(sql`lower(${metrologyControleTypes.name})`, [
            'поверка',
            'калибровка',
          ]),
          isNull(verifications.metrologyControleTypeId)
        )
      )
      .groupBy(verifications.deviceId)
      .as('latest_dates_sub');

    // 2. ПОДЗАПРОС Б: Вытаскиваем valid_until и result строго для этой максимальной даты
    const latestVerificationsSub = this.db
      .select({
        deviceId: verifications.deviceId,
        validUntil: sql`MAX(${verifications.validUntil})`.as('valid_until'),
        result: sql`MAX(${verifications.result})`.as('result'),
      })
      .from(verifications)
      .innerJoin(
        latestDatesSub,
        and(
          eq(verifications.deviceId, latestDatesSub.deviceId),
          eq(verifications.date, latestDatesSub.maxDate)
        )
      )
      .groupBy(verifications.deviceId)
      .as('latest_verifications_sub');

    // 3. ГЛАВНЫЙ ЗАПРОС: Группируем приборы и рассчитываем статусы риска (чистый Drizzle ORM)
    const result = await this.db
      .select({
        cityId: cities.id,
        cityName: cities.name,
        companyId: companies.id,
        companyName: companies.name,
        siteId: productionSites.id,
        siteName: productionSites.name,
        // Считаем общее количество активных СИ
        totalCount: sql<number>`COUNT(${devices.id})::int`,
        // Рассчитываем просроченные приборы (Красные)
        expiredCount: sql<number>`
        COUNT(CASE WHEN 
          lower(${statuses.name}) = 'исправен' AND 
          (${latestVerificationsSub.result} = 'Не годен' OR ${latestVerificationsSub.validUntil} IS NULL OR ${latestVerificationsSub.validUntil} < CURRENT_DATE)
        THEN 1 END)::int`,
        // Рассчитываем предупреждения (Желтые)
        warningCount: sql<number>`
        COUNT(CASE WHEN 
          lower(${statuses.name}) LIKE '%на поверке%' OR
          (lower(${statuses.name}) = 'исправен' AND ${latestVerificationsSub.validUntil} BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
        THEN 1 END)::int`,
      })
      .from(productionSites)
      .innerJoin(cities, eq(cities.id, productionSites.cityId))
      .innerJoin(companies, eq(companies.id, productionSites.companyId))
      // Цепляем приборы к площадкам
      .leftJoin(
        devices,
        and(
          eq(devices.productionSiteId, productionSites.id),
          eq(devices.archived, false)
        )
      )
      // Цепляем статус прибора
      .leftJoin(statuses, eq(statuses.id, devices.statusId))
      // Цецепляем данные нашей последней поверки из подзапроса
      .leftJoin(
        latestVerificationsSub,
        eq(latestVerificationsSub.deviceId, devices.id)
      )
      .groupBy(
        cities.id,
        cities.name,
        companies.id,
        companies.name,
        productionSites.id,
        productionSites.name
      )
      .orderBy(cities.name, companies.name, productionSites.name);

    // 4. СБОРКА ИЕРАРХИЧЕСКОГО ДЕРЕВА MAP -> ARRAY ДЛЯ ФРОНТЕНДА
    const citiesMap = new Map<string, any>();

    for (const row of result) {
      if (!citiesMap.has(row.cityId)) {
        citiesMap.set(row.cityId, {
          id: row.cityId,
          name: row.cityName,
          status: 'green',
          totalCount: 0,
          expiredCount: 0,
          warningCount: 0,
          companiesMap: new Map(),
        });
      }
      const cityNode = citiesMap.get(row.cityId);

      if (!cityNode.companiesMap.has(row.companyId)) {
        cityNode.companiesMap.set(row.companyId, {
          id: row.companyId,
          name: row.companyName,
          status: 'green',
          totalCount: 0,
          expiredCount: 0,
          warningCount: 0,
          sites: [],
        });
      }
      const companyNode = cityNode.companiesMap.get(row.companyId);

      const total = Number(row.totalCount) || 0;
      const expired = Number(row.expiredCount) || 0;
      const warning = Number(row.warningCount) || 0;

      let siteStatus = 'green';
      if (expired > 0) siteStatus = 'error';
      else if (warning > 0) siteStatus = 'warning';

      companyNode.sites.push({
        id: row.siteId,
        name: row.siteName,
        status: siteStatus,
        totalCount: total,
        expiredCount: expired,
        warningCount: warning,
      });

      companyNode.totalCount += total;
      companyNode.expiredCount += expired;
      companyNode.warningCount += warning;
      if (siteStatus === 'error') companyNode.status = 'error';
      else if (siteStatus === 'warning' && companyNode.status !== 'error') {
        companyNode.status = 'warning';
      }

      cityNode.totalCount += total;
      cityNode.expiredCount += expired;
      cityNode.warningCount += warning;
      if (siteStatus === 'error') cityNode.status = 'error';
      else if (siteStatus === 'warning' && cityNode.status !== 'error') {
        cityNode.status = 'warning';
      }
    }

    return {
      cities: Array.from(citiesMap.values()).map((city) => ({
        ...city,
        companies: Array.from(city.companiesMap.values()),
      })),
    };
  }
}
