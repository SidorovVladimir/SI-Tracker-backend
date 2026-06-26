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

  // 3. Строки бюджета с пагинацией и вложенным прибором (1 запрос к БД вместо N+1)
  // async getBudgetPlanItems({
  //   budgetId,
  //   limit,
  //   offset,
  //   filter,
  // }: {
  //   budgetId: string;
  //   limit: number;
  //   offset: number;
  //   filter?:
  //     | { matchMethod?: string | undefined; searchQuery?: string | undefined }
  //     | undefined;
  // }) {
  //   const whereClause = (table: any, { and, eq, or, ilike }: any) => {
  //     const conditions = [eq(table.budgetPlanId, budgetId)];

  //     if (filter?.matchMethod) {
  //       conditions.push(eq(table.matchMethod, filter.matchMethod));
  //     }

  //     // 🎯 ПРОСТОЙ И НАДЕЖНЫЙ ВАРИАНТ: ищем строго по полям самой таблицы
  //     if (filter?.searchQuery) {
  //       conditions.push(
  //         or(
  //           ilike(table.deviceName, `%${filter.searchQuery}%`),
  //           ilike(table.deviceModel, `%${filter.searchQuery}%`)
  //         )
  //       );
  //     }

  //     return and(...conditions);
  //   };

  //   // Сам запрос оставляем легким и плоским:
  //   const items = await this.db.query.budgetPlanItems.findMany({
  //     where: whereClause,
  //     limit,
  //     offset,
  //     with: {
  //       device: true, // Вытаскиваем прибор только для серийного номера
  //     },
  //   });

  //   const [total] = await this.db
  //     .select({ value: count() })
  //     .from(budgetPlanItems)
  //     .where(and(eq(budgetPlanItems.budgetPlanId, budgetId)));

  //   return {
  //     items,
  //     totalCount: total?.value || 0,
  //   };
  // }
  // async getBudgetPlanItems({
  //   budgetId,
  //   limit,
  //   offset,
  //   filter,
  // }: {
  //   budgetId: string;
  //   limit: number;
  //   offset: number;
  //   filter?:
  //     | {
  //         matchMethod?: string | undefined;
  //         searchQuery?: string | undefined;
  //         productionSiteId?: string | undefined;
  //         cityId?: string | undefined;
  //         companyId?: string | undefined;
  //       }
  //     | undefined;
  // }) {
  //   // 1. Базовые условия для самой таблицы budget_plan_items (только по плану и статусу мэтчинга)
  //   const whereClause = (table: any, { and, eq }: any) => {
  //     const conditions = [eq(table.budgetPlanId, budgetId)];
  //     if (filter?.matchMethod) {
  //       conditions.push(eq(table.matchMethod, filter.matchMethod));
  //     }
  //     return and(...conditions);
  //   };

  //   // 2. Вытягиваем строки бюджета сразу со всей вложенной цепочкой связей Drizzle
  //   const items = await this.db.query.budgetPlanItems.findMany({
  //     where: whereClause,
  //     with: {
  //       device: {
  //         with: {
  //           productionSite: {
  //             with: {
  //               city: true,
  //               company: true,
  //             },
  //           },
  //         },
  //       },
  //     },
  //   });

  //   // 3. УМНАЯ И БЕЗОПАСНАЯ ФИЛЬТРАЦИЯ СТРУКТУРЫ ХОЛДИНГА (Snapshot-safe)
  //   const filteredItems = items.filter((item: any) => {
  //     const dev = item.device;
  //     if (!dev) return false;

  //     const site = dev.productionSite;

  //     // А) Фильтрация по UUID-карточкам холдинга (строгое совпадение ID)
  //     if (filter?.cityId && site?.cityId !== filter.cityId) return false;
  //     if (filter?.companyId && site?.companyId !== filter.companyId)
  //       return false;
  //     if (filter?.productionSiteId && site?.id !== filter.productionSiteId)
  //       return false;

  //     // Б) Обычный текстовый поиск по названию или модели прибора из инпута
  //     if (filter?.searchQuery) {
  //       const query = filter.searchQuery.toLowerCase().trim();
  //       const matchName = item.deviceName?.toLowerCase().includes(query);
  //       const matchModel = item.deviceModel?.toLowerCase().includes(query);

  //       if (!matchName && !matchModel) return false;
  //     }

  //     return true;
  //   });

  //   // 4. Пагинация уже отфильтрованного в памяти массива для точного вывода страниц
  //   const totalCount = filteredItems.length;
  //   const slicedItems = filteredItems.slice(offset, offset + limit);

  //   return {
  //     items: slicedItems,
  //     totalCount,
  //   };
  // }

  // async getBudgetPlanItems({
  //   budgetId,
  //   limit,
  //   offset,
  //   filter,
  // }: {
  //   budgetId: string;
  //   limit: number;
  //   offset: number;
  //   filter?:
  //     | {
  //         matchMethod?: string | undefined;
  //         searchQuery?: string | undefined;
  //         city?: string | undefined;
  //         company?: string | undefined;
  //         productionSite?: string | undefined;
  //       }
  //     | undefined;
  // }) {
  //   // 🎯 ШАГ A: Динамически собираем массив условий для Postgres
  //   const sqlConditions = [eq(budgetPlanItems.budgetPlanId, budgetId)];

  //   if (filter?.matchMethod) {
  //     sqlConditions.push(eq(budgetPlanItems.matchMethod, filter.matchMethod));
  //   }

  //   // Защита от ts(2345) 'undefined': формируем массив OR-условий только если строка не пустая
  //   if (filter?.searchQuery && filter.searchQuery.trim() !== '') {
  //     sqlConditions.push(
  //       or(
  //         ilike(budgetPlanItems.deviceName, `%${filter.searchQuery}%`),
  //         ilike(budgetPlanItems.deviceModel, `%${filter.searchQuery}%`)
  //       )! // Восклицательный знак гарантирует TypeScript, что OR выражение не undefined
  //     );
  //   }

  //   // 🎯 Фильтрация по текстовым именам каскада (через Snapshot-поля или сырые связи)
  //   if (filter?.city) {
  //     sqlConditions.push(sql`production_sites.name is not null`); // Заглушка-активатор для JOIN
  //   }

  //   // Собираем базовый селект
  //   const baseQuery = this.db
  //     .select({
  //       id: budgetPlanItems.id,
  //       deviceName: budgetPlanItems.deviceName,
  //       deviceModel: budgetPlanItems.deviceModel,
  //       matchMethod: budgetPlanItems.matchMethod,
  //       basePrice: budgetPlanItems.basePrice,
  //       vatAmount: budgetPlanItems.vatAmount,
  //       totalCost: budgetPlanItems.totalCost,
  //       // Собираем плоский прибор для серийного номера на клиенте
  //       device: {
  //         id: devices.id,
  //         serialNumber: devices.serialNumber,
  //         grsiNumber: devices.grsiNumber,
  //       },
  //     })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(sql`companies c`, sql`production_sites.company_id = c.id`)
  //     .innerJoin(sql`cities`, sql`production_sites.city_id = cities.id`);

  //   // Формируем результирующее условие WHERE
  //   const finalWhereClause = and(...sqlConditions);

  //   // 1. Получаем отфильтрованные строки приборов с учетом пагинации LIMIT и OFFSET
  //   const items = await baseQuery
  //     .where(finalWhereClause)
  //     .limit(limit)
  //     .offset(offset);

  //   // 2. Получаем общее количество строк по этим фильтрам для пагинатора
  //   const [countResult] = await this.db
  //     .select({ count: sql<number>`count(${budgetPlanItems.id})::int` })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(sql`companies c`, sql`production_sites.company_id = c.id`)
  //     .innerJoin(sql`cities`, sql`production_sites.city_id = cities.id`)
  //     .where(finalWhereClause);

  //   // 3. 🎯 САМОЕ ГЛАВНОЕ: Считаем общую сумму по выбранному фильтру ПО ВСЕЙ БАЗЕ ДАННЫХ
  //   const [sumResult] = await this.db
  //     .select({
  //       totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(12,2)`,
  //     })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(sql`companies c`, sql`production_sites.company_id = c.id`)
  //     .innerJoin(sql`cities`, sql`production_sites.city_id = cities.id`)
  //     .where(finalWhereClause);

  //   return {
  //     items: items || [],
  //     totalCount: countResult?.count || 0,
  //     // Передаем точную общую сумму среза на фронтенд (если пусто — возвращаем 0)
  //     totalCostAll: parseFloat(sumResult?.totalCost || '0.00'),
  //   };
  // }
  // async getBudgetPlanItems({
  //   budgetId,
  //   limit,
  //   offset,
  //   filter,
  // }: {
  //   budgetId: string;
  //   limit: number;
  //   offset: number;
  //   filter?:
  //     | {
  //         matchMethod?: string | undefined;
  //         searchQuery?: string | undefined;
  //         city?: string | undefined;
  //         company?: string | undefined;
  //         productionSite?: string | undefined;
  //       }
  //     | undefined;
  // }) {
  //   // 1. Сборка динамических условий фильтрации строго на UUID
  //   const conditions = [eq(budgetPlanItems.budgetPlanId, budgetId)];

  //   if (filter?.matchMethod) {
  //     conditions.push(eq(budgetPlanItems.matchMethod, filter.matchMethod));
  //   }

  //   if (filter?.searchQuery && filter.searchQuery.trim() !== '') {
  //     conditions.push(
  //       or(
  //         ilike(budgetPlanItems.deviceName, `%${filter.searchQuery}%`),
  //         ilike(budgetPlanItems.deviceModel, `%${filter.searchQuery}%`)
  //       )!
  //     );
  //   }

  //   // Фильтрация по ID локаций холдинга (один в один по вашей логике)
  //   if (filter?.company && filter.company !== 'ALL' && filter.company !== '') {
  //     conditions.push(eq(productionSites.companyId, filter.company));
  //   }
  //   if (filter?.city && filter.city !== 'ALL' && filter.city !== '') {
  //     conditions.push(eq(productionSites.cityId, filter.city));
  //   }
  //   if (
  //     filter?.productionSite &&
  //     filter.productionSite !== 'ALL' &&
  //     filter.productionSite !== ''
  //   ) {
  //     conditions.push(eq(productionSites.id, filter.productionSite));
  //   }

  //   const finalWhereClause = and(...conditions);

  //   // 2. ЗАПРОС №1: Получаем строки текущей страницы с точным JOIN локаций
  //   const items = await this.db
  //     .select({
  //       id: budgetPlanItems.id,
  //       deviceName: budgetPlanItems.deviceName,
  //       deviceModel: budgetPlanItems.deviceModel,
  //       matchMethod: budgetPlanItems.matchMethod,
  //       basePrice: budgetPlanItems.basePrice,
  //       vatAmount: budgetPlanItems.vatAmount,
  //       totalCost: budgetPlanItems.totalCost,
  //       device: {
  //         id: devices.id,
  //         serialNumber: devices.serialNumber,
  //         grsiNumber: devices.grsiNumber,
  //       },
  //     })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(finalWhereClause)
  //     .limit(limit)
  //     .offset(offset);

  //   // 3. ЗАПРОС №2: Считаем общее число отфильтрованных позиций для пагинации
  //   const [countResult] = await this.db
  //     .select({ count: sql<number>`count(${budgetPlanItems.id})::int` })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(finalWhereClause);

  //   // 4. ЗАПРОС №3: Пересчет плановой суммы СТРОГО по отфильтрованному срезу
  //   const [sumResult] = await this.db
  //     .select({
  //       totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(12,2)`,
  //     })
  //     .from(budgetPlanItems)
  //     .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
  //     .innerJoin(
  //       productionSites,
  //       eq(devices.productionSiteId, productionSites.id)
  //     )
  //     .innerJoin(companies, eq(productionSites.companyId, companies.id))
  //     .innerJoin(cities, eq(productionSites.cityId, cities.id))
  //     .where(finalWhereClause);

  //   return {
  //     items: items || [],
  //     totalCount: countResult?.count || 0,
  //     totalCostAll: parseFloat(sumResult?.totalCost || '0.00'),
  //   };
  // }

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
      matchMethod?: string;
      searchQuery?: string;
      city?: string;
      company?: string;
      productionSite?: string;
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

    // 🎯 СТРОГАЯ И ЧИСТАЯ ФИЛЬТРАЦИЯ ПО UUID (Никакого текстового мусора!)
    if (filter?.company) {
      sqlConditions.push(eq(productionSites.companyId, filter.company));
    }
    if (filter?.city) {
      sqlConditions.push(eq(productionSites.cityId, filter.city));
    }
    if (filter?.productionSite) {
      sqlConditions.push(eq(productionSites.id, filter.productionSite));
    }

    const finalWhereClause = and(...sqlConditions);

    // 1. Текущая страница приборов
    const items = await this.db
      .select({
        id: budgetPlanItems.id,
        deviceName: budgetPlanItems.deviceName,
        deviceModel: budgetPlanItems.deviceModel,
        matchMethod: budgetPlanItems.matchMethod,
        basePrice: budgetPlanItems.basePrice,
        vatAmount: budgetPlanItems.vatAmount,
        totalCost: budgetPlanItems.totalCost,
        device: {
          id: devices.id,
          serialNumber: devices.serialNumber,
          grsiNumber: devices.grsiNumber,
        },
      })
      .from(budgetPlanItems)
      .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .where(finalWhereClause)
      .limit(limit)
      .offset(offset);

    // 2. Общее число отфильтрованных строк для пагинации страницы
    const [countResult] = await this.db
      .select({ count: sql<number>`count(${budgetPlanItems.id})::int` })
      .from(budgetPlanItems)
      .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .where(finalWhereClause);

    // 3. Динамический пересчет плановой суммы на панели сверху
    const [sumResult] = await this.db
      .select({
        totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(12,2)`,
      })
      .from(budgetPlanItems)
      .innerJoin(devices, eq(budgetPlanItems.deviceId, devices.id))
      .innerJoin(
        productionSites,
        eq(devices.productionSiteId, productionSites.id)
      )
      .where(finalWhereClause);

    return {
      items: items || [],
      totalCount: countResult?.count || 0,
      totalCostAll: parseFloat(sumResult?.totalCost || '0.00'),
    };
  }

  // 4. Создание бюджета с каскадным поиском цен
  // async createBudgetPlan(input: {
  //   year: number;
  //   pricelistIds: string[];
  //   comment?: string | undefined;
  // }) {
  //   const [newPlan] = await this.db
  //     .insert(budgetPlans)
  //     .values({
  //       year: input.year,
  //       comment: input.comment ?? null,
  //       status: 'draft',
  //     })
  //     .returning();

  //   if (!newPlan) {
  //     throw new Error('Failed to create plane');
  //   }

  //   const activeDevices = await this.db
  //     .select()
  //     .from(devices)
  //     .where(eq(devices.archived, false));
  //   const itemsToInsert = [];

  //   for (const device of activeDevices) {
  //     const matchResult = await this.cascadeMatchPrice(
  //       device,
  //       input.pricelistIds
  //     );

  //     const basePrice = matchResult ? parseFloat(matchResult.item.price) : 0;
  //     const vatAmount = basePrice * 0.2;
  //     const totalCost = basePrice + vatAmount;

  //     itemsToInsert.push({
  //       budgetPlanId: newPlan.id,
  //       deviceId: device.id,
  //       deviceName: device.name,
  //       deviceModel: device.model,
  //       matchedPricelistItemId: matchResult ? matchResult.item.id : null,
  //       matchMethod: matchResult ? matchResult.method : 'not_found',
  //       basePrice: basePrice.toFixed(2),
  //       vatAmount: vatAmount.toFixed(2),
  //       totalCost: totalCost.toFixed(2),
  //     });
  //   }

  //   if (itemsToInsert.length > 0) {
  //     await this.db.insert(budgetPlanItems).values(itemsToInsert);
  //   }

  //   return newPlan;
  // }

  async createBudgetPlan(input: {
    year: number;
    pricelistIds: string[];
    comment?: string;
    cityId?: string;
    companyId?: string;
    siteId?: string;
  }) {
    // 1. Создаем сам заголовок плана бюджета
    const [newPlan] = await this.db
      .insert(budgetPlans)
      .values({
        year: input.year,
        comment: input.comment ?? null,
        status: 'draft',
      })
      .returning();

    if (!newPlan) {
      throw new Error('Failed to create plane');
    }

    // 2. Строим условия отбора приборов (Исключаем архивные на корню)
    const deviceConditions = [eq(devices.archived, false)];

    // Жестко зажимаем выборку приборов по локациям, если они были выбраны в модалке создания
    if (input.siteId) {
      deviceConditions.push(eq(devices.productionSiteId, input.siteId));
    } else if (input.companyId || input.cityId) {
      // Если выбран только город или компания — ищем через подзапрос к production_sites
      if (input.companyId) {
        deviceConditions.push(
          sql`production_site_id in (select id from production_sites where company_id = ${input.companyId})`
        );
      }
      if (input.cityId) {
        deviceConditions.push(
          sql`production_site_id in (select id from production_sites where city_id = ${input.cityId})`
        );
      }
    }

    // Достаем строго отфильтрованные приборы холдинга
    const targetDevices = await this.db.query.devices.findMany({
      where: and(...deviceConditions),
    });

    const itemsToInsert = [];

    // 3. Запускаем каскадный подбор цен из прайсов ЦСМ строго по отсеченным приборам
    for (const device of targetDevices) {
      const matchResult = await this.cascadeMatchPrice(
        device,
        input.pricelistIds
      );

      const basePrice = matchResult ? parseFloat(matchResult.item.price) : 0;
      const vatAmount = basePrice * 0.2;
      const totalCost = basePrice + vatAmount;

      itemsToInsert.push({
        budgetPlanId: newPlan.id,
        deviceId: device.id,
        deviceName: device.name,
        deviceModel: device.model,
        matchedPricelistItemId: matchResult ? matchResult.item.id : null,
        matchMethod: matchResult ? matchResult.method : 'not_found',
        basePrice: basePrice.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        totalCost: totalCost.toFixed(2),
      });
    }

    if (itemsToInsert.length > 0) {
      await this.db.insert(budgetPlanItems).values(itemsToInsert);
    }

    return newPlan;
  }

  private async cascadeMatchPrice(device: any, pricelistIds: string[]) {
    if (!pricelistIds || pricelistIds.length === 0) return null;

    if (device.grsiNumber) {
      const [item] = await this.db
        .select()
        .from(pricelistItems)
        .where(
          and(
            inArray(pricelistItems.pricelistId, pricelistIds),
            eq(pricelistItems.grsiNumber, device.grsiNumber)
          )
        )
        .limit(1);
      if (item) return { item, method: 'grsi' };
    }

    if (device.csmCode) {
      const [item] = await this.db
        .select()
        .from(pricelistItems)
        .where(
          and(
            inArray(pricelistItems.pricelistId, pricelistIds),
            eq(pricelistItems.csmCode, device.csmCode)
          )
        )
        .limit(1);
      if (item) return { item, method: 'csm_code' };
    }

    if (device.model) {
      const [item] = await this.db
        .select()
        .from(pricelistItems)
        .where(
          and(
            inArray(pricelistItems.pricelistId, pricelistIds),
            ilike(pricelistItems.modelOrType, device.model)
          )
        )
        .limit(1);
      if (item) return { item, method: 'model_exact' };
    }

    // const [fuzzyItem] = await this.db
    //   .select()
    //   .from(pricelistItems)
    //   .where(
    //     and(
    //       inArray(pricelistItems.pricelistId, pricelistIds),
    //       sql`${pricelistItems.name} % ${device.name}`
    //     )
    //   )
    //   .orderBy(sql`similarity(${pricelistItems.name}, ${device.name}) DESC`)
    //   .limit(1);

    // if (fuzzyItem) return { item: fuzzyItem, method: 'text_fuzzy' };

    // return null;
    // try {
    //   // 4.1. Пробуем Enterprise-вариант через триграммы (для Prod на реальном Postgres)
    //   const [fuzzyItem] = await this.db
    //     .select()
    //     .from(pricelistItems)
    //     .where(
    //       and(
    //         inArray(pricelistItems.pricelistId, pricelistIds),
    //         sql`${pricelistItems.name} % ${device.name}`
    //       )
    //     )
    //     .orderBy(sql`similarity(${pricelistItems.name}, ${device.name}) DESC`)
    //     .limit(1);

    //   if (fuzzyItem) return { item: fuzzyItem, method: 'text_fuzzy' };
    // } catch (trgmError) {
    //   // 4.2. ФОЛБЕК ДЛЯ DEV-РЕЖИМА (PGlite): Если расширения pg_trgm нет, ищем по подстроке
    //   // Разбиваем название прибора на ключевые слова (например, "Измеритель крутящего момента" -> ["измеритель", "крутящего", "момента"])
    //   const words = device.name
    //     .split(' ')
    //     .map((w: any) => w.trim())
    //     .filter((w: any) => w.length > 3); // Игнорируем союзы и предлоги

    //   if (words.length > 0) {
    //     // Формируем цепочку условий ILIKE для каждого слова: name ILIKE '%слово1%' AND name ILIKE '%слово2%'
    //     const subQueries = words.map((word: any) =>
    //       ilike(pricelistItems.name, `%${word}%`)
    //     );

    //     const [fallbackItem] = await this.db
    //       .select()
    //       .from(pricelistItems)
    //       .where(
    //         and(
    //           inArray(pricelistItems.pricelistId, pricelistIds),
    //           ...subQueries
    //         )
    //       )
    //       .limit(1);

    //     if (fallbackItem) return { item: fallbackItem, method: 'text_fuzzy' };
    //   }
    // }

    // // Шаг 5: Если вообще ничего не нашлось
    // return null;

    if (device.name && device.name.trim().length > 3) {
      // 1. Очищаем имя прибора от спецсимволов и преобразуем в поисковую строку для векторов
      // Например: "Измеритель крутящего момента" -> "измеритель & крутящего & момента"
      const cleanSearchQuery = device.name
        .replace(/[^a-zA-Zа-яА-Я0-9\s]/g, '')
        .split(/\s+/)
        .map((w: string) => w.trim())
        .filter((w: string) => w.length > 2)
        .join(' & ');
      if (cleanSearchQuery) {
        const [ftsItem] = await this.db
          .select()
          .from(pricelistItems)
          .where(
            and(
              inArray(pricelistItems.pricelistId, pricelistIds),
              // Сравниваем вектор текста из прайса с поисковым вектором прибора через оператор @@
              sql`to_tsvector('russian', ${pricelistItems.name}) @@ to_tsquery('russian', ${cleanSearchQuery})`
            )
          )
          // Ранжируем результаты по точности совпадения (чтобы самое похожее было сверху)
          .orderBy(
            sql`ts_rank(to_tsvector('russian', ${pricelistItems.name}), to_tsquery('russian', ${cleanSearchQuery})) DESC`
          )
          .limit(1);

        if (ftsItem) return { item: ftsItem, method: 'text_fuzzy' };
      }
    }

    // Шаг 5: Если вообще ничего не нашлось
    return null;
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

  async getBudgetPlans() {
    const plans = await this.db
      .select()
      .from(budgetPlans)
      .orderBy(budgetPlans.year);

    return plans || [];
  }

  async getBudgetPlan(id: string) {
    const [plan] = await this.db
      .select()
      .from(budgetPlans)
      .where(eq(budgetPlans.id, id))
      .limit(1);
    return plan || null;
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

  async deleteBudgetPlan(id: string) {
    return !!(await this.db.delete(budgetPlans).where(eq(budgetPlans.id, id)));
  }

  async deletePricelist(id: string) {
    return !!(await this.db.delete(pricelists).where(eq(pricelists.id, id)));
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

  async getBudgetPlanDistribution(
    budgetId: string,
    groupBy: 'company' | 'city' | 'production_site'
  ) {
    const selectFields: Record<string, any> = {
      count: sql<number>`count(${budgetPlanItems.id})::int`,
      baseSubtotal: sql<string>`sum(${budgetPlanItems.basePrice})::numeric(10,2)`,
      totalCost: sql<string>`sum(${budgetPlanItems.totalCost})::numeric(10,2)`,
    };

    let groupByFields: any[] = [];
    if (groupBy === 'company') {
      selectFields.groupId = sql`c.id`; // 🎯 вытягиваем UUID
      selectFields.groupName = sql`c.name`;
      groupByFields = [sql`c.id`, sql`c.name`];
    } else if (groupBy === 'city') {
      selectFields.groupId = sql`cities.id`; // 🎯 вытягиваем UUID
      selectFields.groupName = sql`cities.name`;
      groupByFields = [sql`cities.id`, sql`cities.name`];
    } else {
      selectFields.groupId = productionSites.id; // 🎯 вытягиваем UUID
      selectFields.groupName = productionSites.name;
      groupByFields = [productionSites.id, productionSites.name];
    }

    // Один оптимизированный JOIN-запрос
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

    return distribution || [];
  }
}
