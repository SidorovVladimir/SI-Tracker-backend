import { and, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity } from '../types/device.types';
import {
  deviceDocuments,
  devices,
  devicesToBatches,
  verificationBatches,
} from '../models/device.model';
import { scopes, scopesToDevices } from '../../catalog/models/scope.model';
import { verifications } from '../models/verification.model';
import { UpdateDeviceInput } from '../dto/UpdateDeviceDto';
import {
  primaryStandarts,
  primaryStandartsToDevices,
} from '../../catalog/models/primaryStandarts.model';
import {
  measurementTypes,
  measurementTypesToDevices,
} from '../../catalog/models/measurementType.model';
import { DeviceAuditLogService } from '../../audit/auditLog.service';
import { CreateVerificationDto } from '../dto/CreateVerificationDto';
import { statuses } from '../../catalog/models/status.model';
import { SyncDeviceWithArshinInput } from '../../arshin/dto/SyncDeviceWithArshinDto';
import { ArshinService } from '../../arshin/service/arshin.service';
import { verificationOrganizations } from '../../catalog/models/verificationOrganization.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { ImportDeviceItem } from '../dto/ImportDeviceItemDto';
import { cities } from '../../location/models/city.model';
import { companies } from '../../location/models/company.model';
import { productionSites } from '../../location/models/productionSites.model';
import { equipmentTypes } from '../../catalog/models/equipmentType.model';
import { arshinQueue } from '../queues/arshin.queue';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { DOCUMENTS_DIR } from '../../../config/path.config';

export interface PrintBarcodesInput {
  deviceIds?: string[];
  // controlType?: string;
  historyLinkIds?: string[];
}

export class DeviceService {
  constructor(
    private db: DrizzleDB,
    // private arshinService?: ArshinService,
    private auditLogService?: DeviceAuditLogService
  ) {}
  async getDevices(): Promise<DeviceEntity[]> {
    return await this.db.select().from(devices);
  }

  async getDevicesWithRelations(args: {
    limit: number;
    offset: number;
    filter?: any;
  }) {
    const { limit = 25, offset = 0, filter } = args;

    // const conditions = [eq(devices.archived, false)];

    const conditions = [];

    if (filter?.includeArchived === true) {
      // Режим 1: Выбрано "Все приборы".
      // Мы просто НИЧЕГО не добавляем в массив условий, Postgres выведет и true, и false вместе.
    } else if (filter?.archived === true) {
      // Режим 2: Выбрано "Только архив".
      conditions.push(eq(devices.archived, true));
    } else {
      // Режим 3: Выбрано "Активные" ИЛИ первая загрузка страницы (по умолчанию)
      conditions.push(eq(devices.archived, false));
    }

    // const conditions = [eq(devices.archived, filter.archived)];
    // 1. Фильтр по наименованию (Регистронезависимый поиск ILIKE)
    if (filter?.deviceName) {
      conditions.push(ilike(devices.name, `%${filter.deviceName}%`));
    }

    // 2. Фильтр по заводскому номеру
    if (filter?.serialNumber) {
      conditions.push(ilike(devices.serialNumber, `%${filter.serialNumber}%`));
    }

    if (filter?.status) {
      conditions.push(
        sql`${devices.statusId} IN (
          SELECT id FROM statuses WHERE LOWER(TRIM(name)) = LOWER(TRIM(${filter.status}))
        )`
      );
    }

    // 4. Фильтр по названию подразделения (Production Site)
    if (filter?.productionSite) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
      SELECT id FROM production_sites 
      WHERE LOWER(TRIM(name)) = LOWER(TRIM(${filter.productionSite}))
    )`
      );
    }

    // 5. Фильтр по названию города (через таблицу подразделений production_sites)
    if (filter?.city) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
          SELECT ps.id FROM production_sites ps
          JOIN cities c ON ps.city_id = c.id
          WHERE LOWER(TRIM(c.name)) = LOWER(TRIM(${filter.city}))
        )`
      );
    }

    // 6. Фильтр по названию организации/компании (через таблицу подразделений)
    if (filter?.company) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
      SELECT ps.id FROM production_sites ps
      JOIN companies comp ON ps.company_id = comp.id
      WHERE LOWER(TRIM(comp.name)) = LOWER(TRIM(${filter.company}))
    )`
      );
    }

    // 7. Фильтр по виду контроля актуальной поверки (подзапрос к verifications)
    // if (filter?.metrologyControle) {
    //   conditions.push(
    //     sql`${devices.id} IN (
    //       SELECT v.device_id FROM verifications v
    //       JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
    //       WHERE LOWER(TRIM(mct.name)) = LOWER(TRIM(${filter.metrologyControle}))
    //       AND v.valid_until = (
    //         SELECT MAX(valid_until) FROM verifications WHERE device_id = v.device_id
    //       )
    //     )`
    //   );
    // }

    // if (filter?.metrologyControle) {
    //   const controlName = String(filter.metrologyControle).toLowerCase().trim();

    //   if (controlName === 'осмотр') {
    //     // Если ищут приборы по Осмотру — смотрим на самый свежий осмотр
    //     conditions.push(
    //       sql`${devices.id} IN (
    //         SELECT v.device_id FROM verifications v
    //         JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
    //         WHERE LOWER(TRIM(mct.name)) = 'осмотр'
    //         AND v.date = (
    //           SELECT MAX(date) FROM verifications
    //           WHERE device_id = v.device_id
    //           AND metrology_controle_type_id = (SELECT id FROM metrology_controle_types WHERE LOWER(TRIM(name)) = 'осмотр')
    //         )
    //       )`
    //     );
    //   } else {
    //     // Если ищут Поверку/Калибровку/Аттестацию — смотрим на MAX(valid_until) только среди них!
    //     conditions.push(
    //       sql`${devices.id} IN (
    //         SELECT v.device_id FROM verifications v
    //         JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
    //         WHERE LOWER(TRIM(mct.name)) = ${controlName}
    //         AND v.valid_until = (
    //           SELECT MAX(valid_until) FROM verifications v2
    //           JOIN metrology_controle_types mct2 ON v2.metrology_controle_type_id = mct2.id
    //           WHERE v2.device_id = v.device_id AND LOWER(TRIM(mct2.name)) != 'осмотр'
    //         )
    //       )`
    //     );
    //   }
    // }

    // // 5. ИСПРАВЛЕННЫЕ ДАТЫ: Фильтры по датам теперь смотрят ИСКЛЮЧИТЕЛЬНО на государеву поверку (игнорируя осмотры)
    // if (filter?.dateStart) {
    //   const safeDateStart = String(filter.dateStart).slice(0, 10);
    //   conditions.push(
    //     sql`${devices.id} IN (
    //       SELECT v.device_id FROM verifications v
    //       JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
    //       WHERE LOWER(TRIM(mct.name)) != 'осмотр'
    //       AND v.valid_until::date >= ${safeDateStart}::date
    //       AND v.valid_until = (
    //         SELECT MAX(valid_until) FROM verifications v2
    //         JOIN metrology_controle_types mct2 ON v2.metrology_controle_type_id = mct2.id
    //         WHERE v2.device_id = v.device_id AND LOWER(TRIM(mct2.name)) != 'осмотр'
    //       )
    //     )`
    //   );
    // }

    // if (filter?.dateEnd) {
    //   const safeDateEnd = String(filter.dateEnd).slice(0, 10);
    //   conditions.push(
    //     sql`${devices.id} IN (
    //       SELECT v.device_id FROM verifications v
    //       JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
    //       WHERE LOWER(TRIM(mct.name)) != 'осмотр'
    //       AND v.valid_until::date <= ${safeDateEnd}::date
    //       AND v.valid_until = (
    //         SELECT MAX(valid_until) FROM verifications v2
    //         JOIN metrology_controle_types mct2 ON v2.metrology_controle_type_id = mct2.id
    //         WHERE v2.device_id = v.device_id AND LOWER(TRIM(mct2.name)) != 'осмотр'
    //       )
    //     )`
    //   );
    // }

    if (filter?.metrologyControle) {
      const controlName = String(filter.metrologyControle).toLowerCase().trim();

      conditions.push(
        sql`${devices.id} IN (
          SELECT v.device_id FROM verifications v
          JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
          LEFT JOIN equipment_types eq ON ${devices.equipmentTypeId} = eq.id
          WHERE LOWER(TRIM(mct.name)) = ${controlName}
            -- Проверяем, что эта запись является ОПРЕДЕЛЯЮЩЕЙ по правилам метролога:
            AND LOWER(TRIM(mct.name)) = CASE 
              WHEN LOWER(TRIM(eq.name)) IN ('индикатор', 'вспомогательное оборудование (во)') THEN 'осмотр'
              WHEN LOWER(TRIM(eq.name)) = 'средство измерений (си)' THEN 
                CASE WHEN ${devices.grsiNumber} IS NOT NULL AND ${devices.grsiNumber} != '' 
                  AND ${devices.id} NOT IN (
                    SELECT device_id FROM scopes_to_devices std 
                    JOIN scopes sc ON std.scope_id = sc.id 
                    WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                  ) THEN 'поверка' ELSE 'осмотр' END
              WHEN LOWER(TRIM(eq.name)) = 'средство контроля (ск)' THEN 
                CASE WHEN ${devices.id} IN (
                  SELECT device_id FROM scopes_to_devices std 
                  JOIN scopes sc ON std.scope_id = sc.id 
                  WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                ) THEN 'осмотр'
                WHEN ${devices.grsiNumber} IS NOT NULL AND ${devices.grsiNumber} != '' THEN 'поверка'
                ELSE 'калибровка' END
              WHEN LOWER(TRIM(eq.name)) = 'испытательное оборудование (ио)' THEN 
                CASE WHEN ${devices.id} IN (
                  SELECT device_id FROM scopes_to_devices std 
                  JOIN scopes sc ON std.scope_id = sc.id 
                  WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                ) THEN 'осмотр' ELSE 'аттестация' END
              ELSE 'осмотр'
            END
            -- И что это самый свежий документ этого типа
            AND v.date = (
              SELECT MAX(v3.date) FROM verifications v3 
              WHERE v3.device_id = v.device_id AND v3.metrology_controle_type_id = v.metrology_controle_type_id
            )
        )`
      );
    }

    // 8. ИСПРАВЛЕННЫЕ ФИЛЬТРЫ ПО ДАТАМ (Ищут только внутри ОПРЕДЕЛЯЮЩЕГО контроля)
    if (filter?.dateStart || filter?.dateEnd) {
      const dateStartCond = filter?.dateStart
        ? sql`AND v.valid_until::date >= ${String(filter.dateStart).slice(
            0,
            10
          )}::date`
        : sql`1=1`;
      const dateEndCond = filter?.dateEnd
        ? sql`AND v.valid_until::date <= ${String(filter.dateEnd).slice(
            0,
            10
          )}::date`
        : sql`1=1`;

      conditions.push(
        sql`${devices.id} IN (
          SELECT v.device_id FROM verifications v
          JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
          LEFT JOIN equipment_types eq ON ${devices.equipmentTypeId} = eq.id
          WHERE 1=1
            ${dateStartCond}
            ${dateEndCond}
            -- Жесткая привязка к типу контроля метролога
            AND LOWER(TRIM(mct.name)) = CASE 
              WHEN LOWER(TRIM(eq.name)) IN ('индикатор', 'вспомогательное оборудование (во)') THEN 'осмотр'
              WHEN LOWER(TRIM(eq.name)) = 'средство измерений (си)' THEN 
                CASE WHEN ${devices.grsiNumber} IS NOT NULL AND ${devices.grsiNumber} != '' 
                  AND ${devices.id} NOT IN (
                    SELECT device_id FROM scopes_to_devices std 
                    JOIN scopes sc ON std.scope_id = sc.id 
                    WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                  ) THEN 'поверка' ELSE 'осмотр' END
              WHEN LOWER(TRIM(eq.name)) = 'средство контроля (ск)' THEN 
                CASE WHEN ${devices.id} IN (
                  SELECT device_id FROM scopes_to_devices std 
                  JOIN scopes sc ON std.scope_id = sc.id 
                  WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                ) THEN 'осмотр'
                WHEN ${devices.grsiNumber} IS NOT NULL AND ${devices.grsiNumber} != '' THEN 'поверка'
                ELSE 'калибровка' END
              WHEN LOWER(TRIM(eq.name)) = 'испытательное оборудование (ио)' THEN 
                CASE WHEN ${devices.id} IN (
                  SELECT device_id FROM scopes_to_devices std 
                  JOIN scopes sc ON std.scope_id = sc.id 
                  WHERE LOWER(TRIM(sc.name)) IN ('не гр', 'вне сферы государственного регулирования (не гр)')
                ) THEN 'осмотр' ELSE 'аттестация' END
              ELSE 'осмотр'
            END
            AND v.date = (
              SELECT MAX(v3.date) FROM verifications v3 
              WHERE v3.device_id = v.device_id AND v3.metrology_controle_type_id = v.metrology_controle_type_id
            )
        )`
      );
    }

    const whereClause = and(...conditions);

    // Считаем точное число строк С УЧЕТОМ фильтров, чтобы пагинатор DataGrid знал число страниц
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(whereClause);

    const items = await this.db.query.devices.findMany({
      where: whereClause,
      limit,
      offset,
      orderBy: (d, { desc }) => [desc(d.updatedAt)],
      columns: {
        id: true,
        name: true,
        model: true,
        grsiNumber: true,
        serialNumber: true,
        inventoryNumber: true,
        releaseDate: true,
        manufacturer: true,
      },
      with: {
        equipmentType: { columns: { name: true } },
        scopesToDevices: {
          with: {
            scope: true,
          },
        },
        status: { columns: { name: true } },
        productionSite: {
          columns: { name: true },
          with: {
            city: { columns: { name: true } },
            company: { columns: { name: true } },
          },
        },
        // База выгребает СТРОГО 1 последнюю поверку прибора!
        verifications: {
          // orderBy: (v, { desc }) => [desc(v.validUntil), desc(v.date)],
          orderBy: (v) => [sql`${v.date} DESC NULLS LAST`],
          // limit: 1, // Пока убрали для получения всех поверок
          columns: {
            id: true,
            date: true,
            validUntil: true,
            protocolNumber: true,
          },
          with: { metrologyControleType: { columns: { name: true } } },
        },
      },
    });

    // 6. МАППИНГ (Разделение записей по логическим колонкам для DataGrid)
    return {
      items: items.map((d) => {
        // Ищем самую свежую официальную поверку / калибровку
        //     const latestVerification =
        //       d.verifications.find(
        //         (v) =>
        //           v.metrologyControleType?.name?.toLowerCase().trim() !== 'осмотр'
        //       ) || null;

        //     // Ищем самый свежий внутренний осмотр
        //     const latestInspection =
        //       d.verifications.find(
        //         (v) =>
        //           v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
        //       ) || null;

        //     return {
        //       id: d.id,
        //       name: d.name,
        //       model: d.model,
        //       grsiNumber: d.grsiNumber,
        //       serialNumber: d.serialNumber,
        //       inventoryNumber: d.inventoryNumber,
        //       releaseDate: d.releaseDate,
        //       manufacturer: d.manufacturer,
        //       status: d.status,
        //       productionSite: d.productionSite,

        //       // Отдаем на фронтенд два РАЗДЕЛЬНЫХ объекта
        //       latestVerification,
        //       latestInspection,
        //     };
        //   }),
        //   totalCount: countResult?.count ?? 0,
        // };
        const eqTypeName = d.equipmentType?.name?.toLowerCase().trim() ?? '';
        const grsiNumber = d.grsiNumber;
        const hasGrsi = !!grsiNumber && grsiNumber.trim() !== '';

        const deviceScopes = (d.scopesToDevices ?? [])
          .filter((s: any) => s?.scope?.name)
          .map((s: any) => s.scope.name.toLowerCase().trim());

        const isNotGr =
          deviceScopes.includes('не гр') ||
          deviceScopes.includes(
            'вне сферы государственного регулирования (не гр)'
          );

        // 1. Сначала ВСЕГДА находим самый свежий внутренний осмотр для отдельной колонки
        const absoluteLatestInspection =
          d.verifications.find(
            (v) =>
              v.metrologyControleType?.name?.toLowerCase().trim() === 'осмотр'
          ) || null;

        // 2. 🎯 ВЫЧИСЛЯЕМ СТРОГОЕ НАЗВАНИЕ ЦЕЛЕВОГО КОНТРОЛЯ:
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

        // 3. 🎯 ИЩЕМ В ИСТОРИИ ЗАПИСЬ СТРОГО С ВЫЧИСЛЕННЫМ НАЗВАНИЕМ КОНТРОЛЯ
        // Благодаря [v.date DESC] в findMany, это будет самый свежий документ именно ЭТОГО вида
        const targetControl =
          d.verifications.find(
            (v) =>
              v.metrologyControleType?.name?.toLowerCase().trim() ===
              targetControlName
          ) || null;

        return {
          id: d.id,
          name: d.name,
          model: d.model,
          grsiNumber: d.grsiNumber,
          serialNumber: d.serialNumber,
          inventoryNumber: d.inventoryNumber,
          releaseDate: d.releaseDate,
          manufacturer: d.manufacturer,
          status: d.status,
          productionSite: d.productionSite,

          // Целевой контроль теперь выведет СТРОГО нужный документ (например, только калибровку для СК без ГРСИ)
          latestVerification: targetControl,

          // Колонка осмотра остается независимой
          latestInspection: absoluteLatestInspection,
        };
      }),
      totalCount: countResult?.count ?? 0,
    };
  }

  async getDevice(id: string) {
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, id),
      with: {
        status: true,
        equipmentType: true,
        documents: true,
        createdBy: true,
        updatedBy: true,
        productionSite: {
          with: {
            city: true,
            company: true,
          },
        },
        scopesToDevices: {
          with: {
            scope: true,
          },
        },
        primaryStandartsToDevices: {
          with: {
            primaryStandart: true,
          },
        },
        measurementTypesToDevices: {
          with: {
            measurementType: true,
          },
        },
        verifications: {
          orderBy: (verifications, { asc }) => [asc(verifications.validUntil)],
          with: {
            metrologyControleType: true,
            verificationOrganization: true,
          },
        },
      },
    });

    if (!data) return null;

    const manualDocs = await this.db.query.deviceDocuments.findMany({
      where: (doc) => {
        return or(
          // Если это СИ с ГРСИ: ищем РЭ, где совпадает И ГРСИ, И Модель (а deviceId пустой)
          data.grsiNumber && data.model
            ? and(
                eq(doc.grsiNumber, data.grsiNumber),
                eq(doc.modelName, data.model),
                isNull(doc.deviceId)
              )
            : undefined,

          // Если это ИО/ВО (ГРСИ нет): ищем РЭ, где совпадает только Модель (а ГРСИ и deviceId пустые)
          !data.grsiNumber && data.model
            ? and(
                eq(doc.modelName, data.model),
                isNull(doc.grsiNumber),
                isNull(doc.deviceId)
              )
            : undefined
        );
      },
    });

    const scopes = data?.scopesToDevices.map((sd) => sd.scope);
    const primaryStandarts = data?.primaryStandartsToDevices.map(
      (psd) => psd.primaryStandart
    );
    const measurementTypes = data?.measurementTypesToDevices.map(
      (mt) => mt.measurementType
    );

    const allDocuments = [...(data.documents || []), ...manualDocs];
    return {
      ...data,
      scopes,
      primaryStandarts,
      measurementTypes,
      documents: allDocuments,
    };
  }

  // async getDevice(id: string) {
  //   // 1. Извлекаем плоскую базовую строку прибора и его прякие связи 1-to-1
  //   const [baseDevice] = await this.db
  //     .select({
  //       device: devices,
  //       status: statuses,
  //       equipmentType: equipmentTypes,
  //       productionSite: productionSites,
  //       city: cities,
  //       company: companies,
  //     })
  //     .from(devices)
  //     .leftJoin(statuses, eq(statuses.id, devices.statusId))
  //     .leftJoin(equipmentTypes, eq(equipmentTypes.id, devices.equipmentTypeId))
  //     .leftJoin(
  //       productionSites,
  //       eq(productionSites.id, devices.productionSiteId)
  //     )
  //     .leftJoin(cities, eq(cities.id, productionSites.cityId))
  //     .leftJoin(companies, eq(companies.id, productionSites.companyId))
  //     .where(eq(devices.id, id))
  //     .execute();

  //   if (!baseDevice) return null;

  //   // 2. Изолированно вытаскиваем историю поверок (без каши в подзапросах)
  //   const rawVerifications = await this.db
  //     .select({
  //       verification: verifications,
  //       metrologyControleType: metrologyControleTypes,
  //       verificationOrganization: verificationOrganizations,
  //     })
  //     .from(verifications)
  //     .leftJoin(
  //       metrologyControleTypes,
  //       eq(metrologyControleTypes.id, verifications.metrologyControleTypeId)
  //     )
  //     .leftJoin(
  //       verificationOrganizations,
  //       eq(
  //         verificationOrganizations.id,
  //         verifications.verificationOrganizationId
  //       )
  //     )
  //     .where(eq(verifications.deviceId, id))
  //     .execute();

  //   // Сортируем поверки на уровне JS (asc по validUntil)
  //   const sortedVerifications = rawVerifications
  //     .map((v) => ({
  //       ...v.verification,
  //       metrologyControleType: v.metrologyControleType,
  //       verificationOrganization: v.verificationOrganization,
  //     }))
  //     .sort((a, b) => {
  //       const dateA = a.validUntil ? new Date(a.validUntil).getTime() : 0;
  //       const dateB = b.validUntil ? new Date(b.validUntil).getTime() : 0;
  //       return dateA - dateB;
  //     });

  //   // 3. Извлекаем связанные Many-to-Many массивы справочников (Сферы, Эталоны, Виды измерений)
  //   const rawScopes = await this.db
  //     .select({ scope: scopes })
  //     .from(scopesToDevices)
  //     .innerJoin(scopes, eq(scopes.id, scopesToDevices.scopeId))
  //     .where(eq(scopesToDevices.deviceId, id))
  //     .execute();

  //   const rawStandards = await this.db
  //     .select({ standard: primaryStandarts })
  //     .from(primaryStandartsToDevices)
  //     .innerJoin(
  //       primaryStandarts,
  //       eq(primaryStandarts.id, primaryStandartsToDevices.primaryStandartId)
  //     )
  //     .where(eq(primaryStandartsToDevices.deviceId, id))
  //     .execute();

  //   const rawMeasurements = await this.db
  //     .select({ measurement: measurementTypes })
  //     .from(measurementTypesToDevices)
  //     .innerJoin(
  //       measurementTypes,
  //       eq(measurementTypes.id, measurementTypesToDevices.measurementTypeId)
  //     )
  //     .where(eq(measurementTypesToDevices.deviceId, id))
  //     .execute();

  //   // 4. Собираем идеальный GraphQL-ответ, полностью повторяющий вашу прошлую структуру объекта
  //   return {
  //     ...baseDevice.device,
  //     status: baseDevice.status,
  //     equipmentType: baseDevice.equipmentType,
  //     productionSite: baseDevice.productionSite
  //       ? {
  //           ...baseDevice.productionSite,
  //           city: baseDevice.city,
  //           company: baseDevice.company,
  //         }
  //       : null,
  //     verifications: sortedVerifications,
  //     scopes: rawScopes.map((r) => r.scope),
  //     primaryStandarts: rawStandards.map((r) => r.standard),
  //     measurementTypes: rawMeasurements.map((r) => r.measurement),
  //   };
  // }

  private async getFlatAuditSnapshot(deviceId: string) {
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, deviceId),
      columns: {
        id: true,
        name: true,
        model: true,
        csmCode: true,
        serialNumber: true,
        grsiNumber: true,
        measurementRange: true,
        accuracy: true,
        inventoryNumber: true,
        manufacturer: true,
        verificationInterval: true,
        archived: true,
        nomenclature: true,
        comment: true,
      },
      with: {
        status: { columns: { name: true } },
        equipmentType: { columns: { name: true } },
        productionSite: {
          columns: { name: true },
          with: {
            city: { columns: { name: true } },
            company: { columns: { name: true } },
          },
        },
        scopesToDevices: { with: { scope: { columns: { name: true } } } },
        primaryStandartsToDevices: {
          with: { primaryStandart: { columns: { name: true } } },
        },
        measurementTypesToDevices: {
          with: { measurementType: { columns: { name: true } } },
        },
        verifications: {
          orderBy: (verifications, { asc }) => [asc(verifications.validUntil)],
          columns: {
            id: true,
            date: true,
            validUntil: true,
            result: true,
            protocolNumber: true,
            comment: true,
            documentUrl: true,
            cost: true,
          },
          with: {
            metrologyControleType: { columns: { name: true } },
            verificationOrganization: { columns: { name: true } },
          },
        },
      },
    });

    if (!data) return null;

    return {
      id: data.id,
      name: data.name,
      model: data.model,
      serialNumber: data.serialNumber,
      grsiNumber: data.grsiNumber,
      csmCode: data.csmCode,
      accuracy: data.accuracy,
      inventoryNumber: data.inventoryNumber,
      verificationInterval: data.verificationInterval,
      archived: data.archived,
      manufacturer: data.manufacturer,
      status: data.status?.name || 'не указан',
      equipmentType: data.equipmentType?.name || 'не указан',
      productionSite: data.productionSite?.name || 'не указан',
      scopes: data.scopesToDevices.map((s) => s.scope?.name).filter(Boolean),
      measurementTypes: data.measurementTypesToDevices
        .map((m) => m.measurementType?.name)
        .filter(Boolean),
      verifications: data.verifications.map((v) => ({
        id: v.id,
        date: v.date,
        validUntil: v.validUntil,
        result: v.result,
        protocolNumber: v.protocolNumber,
        comment: v.comment,
        documentUrl: v.documentUrl,
        metrologyControleType: v.metrologyControleType?.name || '—',
        verificationOrganization: v.verificationOrganization?.name || '—',
      })),
    };
  }

  async createDevice(input: CreateDeviceInput, userId: string) {
    const deviceData = {
      name: input.name.toLowerCase(),
      model: input.model.toLowerCase(),
      serialNumber: input.serialNumber.toLowerCase(),
      releaseDate: input.releaseDate,
      csmCode: input.csmCode?.toLowerCase() ?? null,
      grsiNumber: input.grsiNumber?.toLowerCase() ?? null,
      measurementRange: input.measurementRange?.toLowerCase() ?? null,
      accuracy: input.accuracy?.toLowerCase() ?? null,
      inventoryNumber: input.inventoryNumber?.toLowerCase() ?? null,
      receiptDate: input.receiptDate,
      manufacturer: input.manufacturer?.toLowerCase() ?? null,
      verificationInterval: input.verificationInterval,
      archived: input.archived,
      nomenclature: input.nomenclature?.toLowerCase() ?? null,
      comment: input.comment?.toLowerCase() ?? null,
      statusId: input.statusId,
      productionSiteId: input.productionSiteId,
      equipmentTypeId: input.equipmentTypeId ?? null,
      createdById: userId,
      updatedById: userId,
    };

    const result = await this.db.transaction(async (tx) => {
      const [newDevice] = await tx
        .insert(devices)
        .values(deviceData)
        .returning();

      if (!newDevice) {
        throw new Error('Failed to create device');
      }

      if (input.scopes && input.scopes.length > 0) {
        const scopesData = input.scopes.map((sId) => ({
          deviceId: newDevice.id,
          scopeId: sId,
        }));

        await tx.insert(scopesToDevices).values(scopesData);
      }

      if (input.primaryStandarts && input.primaryStandarts.length > 0) {
        const primaryStandartsData = input.primaryStandarts.map((psId) => ({
          deviceId: newDevice.id,
          primaryStandartId: psId,
        }));

        await tx.insert(primaryStandartsToDevices).values(primaryStandartsData);
      }

      if (input.measurementTypes && input.measurementTypes.length > 0) {
        const measurementTypesData = input.measurementTypes.map((mtId) => ({
          deviceId: newDevice.id,
          measurementTypeId: mtId,
        }));

        await tx.insert(measurementTypesToDevices).values(measurementTypesData);
      }

      if (input.verifications && input.verifications.length > 0) {
        const verificationsData = input.verifications.map((verification) => ({
          ...verification,
          metrologyControleTypeId: verification.metrologyControleTypeId ?? null,
          verificationOrganizationId:
            verification.verificationOrganizationId ?? null,
          deviceId: newDevice.id,
          cost:
            verification.cost !== undefined && verification.cost !== null
              ? String(verification.cost)
              : '0.00',
        }));

        await tx.insert(verifications).values(verificationsData);
      }

      return newDevice;
    });

    if (this.auditLogService) {
      const fullDeviceSnapshot = await this.getFlatAuditSnapshot(result.id);

      await this.auditLogService.logAction({
        deviceId: result.id,
        action: 'create',
        newData: fullDeviceSnapshot,
        userId,
      });
    }

    return result;
  }

  async updateDevice(
    id: string,
    input: UpdateDeviceInput,
    userId: string
  ): Promise<DeviceEntity> {
    // const oldDataSnapshot = await this.getDevice(id);
    const oldDataSnapshot = await this.getFlatAuditSnapshot(id);
    if (!oldDataSnapshot) throw new Error('Device not found');

    const deviceData = {
      name: input.name.toLowerCase(),
      model: input.model.toLowerCase(),
      serialNumber: input.serialNumber.toLowerCase(),
      releaseDate: input.releaseDate,
      csmCode: input.csmCode?.toLowerCase() ?? null,
      grsiNumber: input.grsiNumber?.toLowerCase() ?? null,
      measurementRange: input.measurementRange?.toLowerCase() ?? null,
      accuracy: input.accuracy?.toLowerCase() ?? null,
      inventoryNumber: input.inventoryNumber?.toLowerCase() ?? null,
      receiptDate: input.receiptDate,
      manufacturer: input.manufacturer?.toLowerCase() ?? null,
      verificationInterval: input.verificationInterval,
      archived: input.archived,
      nomenclature: input.nomenclature?.toLowerCase() ?? null,
      comment: input.comment?.toLowerCase() ?? null,
      statusId: input.statusId,
      productionSiteId: input.productionSiteId,
      equipmentTypeId: input.equipmentTypeId ?? null,
      updatedAt: new Date(),
      updatedById: userId,
    };

    const result = await this.db.transaction(async (tx) => {
      const [updateDevice] = await tx
        .update(devices)
        .set(deviceData)
        .where(eq(devices.id, id))
        .returning();

      if (!updateDevice) {
        throw new Error('Failed to update device');
      }

      await tx.delete(scopesToDevices).where(eq(scopesToDevices.deviceId, id));

      if (input.scopes && input.scopes.length > 0) {
        const valuesToInsert = input.scopes.map((sId) => ({
          deviceId: id,
          scopeId: sId,
        }));

        await tx.insert(scopesToDevices).values(valuesToInsert);
      }

      await tx
        .delete(primaryStandartsToDevices)
        .where(eq(primaryStandartsToDevices.deviceId, id));

      if (input.primaryStandarts && input.primaryStandarts.length > 0) {
        const valuesToInsert = input.primaryStandarts.map((psId) => ({
          deviceId: id,
          primaryStandartId: psId,
        }));

        await tx.insert(primaryStandartsToDevices).values(valuesToInsert);
      }

      await tx
        .delete(measurementTypesToDevices)
        .where(eq(measurementTypesToDevices.deviceId, id));

      if (input.measurementTypes && input.measurementTypes.length > 0) {
        const valuesToInsert = input.measurementTypes.map((mtId) => ({
          deviceId: id,
          measurementTypeId: mtId,
        }));

        await tx.insert(measurementTypesToDevices).values(valuesToInsert);
      }

      const dbVerifications = await tx
        .select({ id: verifications.id })
        .from(verifications)
        .where(eq(verifications.deviceId, id));
      const dbIds = dbVerifications.map((v) => v.id);

      const incomingIds = (input.verifications || [])
        .map((v: any) => v.id)
        .filter(Boolean) as string[];

      const idsToDelete = dbIds.filter((dbId) => !incomingIds.includes(dbId));

      if (idsToDelete.length > 0) {
        await tx
          .delete(verifications)
          .where(inArray(verifications.id, idsToDelete));
      }

      if (input.verifications && input.verifications.length > 0) {
        for (const v of input.verifications as any[]) {
          const payload = {
            date: v.date ? new Date(v.date) : new Date(), // Обязательное поле date
            validUntil: v.validUntil ? new Date(v.validUntil) : null, // Необязательное validUntil
            result: v.result,
            protocolNumber: v.protocolNumber,
            organization: v.organization,
            comment: v.comment,
            documentUrl: v.documentUrl || null,
            metrologyControleTypeId: v.metrologyControleTypeId ?? null,
            verificationOrganizationId: v.verificationOrganizationId ?? null,
            deviceId: id,
            cost:
              v.cost !== undefined && v.cost !== null ? String(v.cost) : '0.00',
          };

          if (v.id) {
            // Сценарий А: Поверка уже существовала. Мягко обновляем её поля.
            // База данных сохранит batchId и файлы, так как мы НЕ трогаем эти колонки!
            await tx
              .update(verifications)
              .set(payload)
              .where(eq(verifications.id, v.id));
          } else {
            // Сценарий Б: Абсолютно новая строка, добавленная кнопкой "Добавить"
            await tx.insert(verifications).values(payload);
          }
        }
      }

      return updateDevice;
    });

    // ЗДЕСЬ ТРАНЗАКЦИЯ УСПЕШНО ЗАКРЫЛАСЬ, ВСЕ БЛОКИРОВКИ С БД СНЯТЫ!

    // 2. ПОСЛЕ транзакции снимаем свежий плоский снимок изменений
    const newDataSnapshot = await this.getFlatAuditSnapshot(id);

    // =========================================================================
    // 3. БЕЗОПАСНАЯ ЗАПИСЬ В ЖУРНАЛ АУДИТА ВНЕ ТРАНЗАКЦИИ (БЕЗ ДЕДЛОКОВ!)
    // =========================================================================
    if (this.auditLogService && oldDataSnapshot && newDataSnapshot) {
      await this.auditLogService.logAction({
        deviceId: id,
        action: 'update',
        oldData: oldDataSnapshot, // Отправляем плоский снимок "Было" с массивом поверок
        newData: newDataSnapshot, // Отправляем плоский снимок "Стало" с массивом поверок
        userId, // Лог запишется мгновенно
      });
    }

    return result;
  }

  async deleteDevice(id: string, userId: string): Promise<boolean> {
    const oldDataSnapshot = await this.getFlatAuditSnapshot(id);

    if (!oldDataSnapshot) {
      throw new Error('Прибор для архивации не найден');
    }

    const filePathsToDiskDelete: string[] = [];

    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(scopesToDevices)
          .where(eq(scopesToDevices.deviceId, id));

        await tx
          .delete(primaryStandartsToDevices)
          .where(eq(primaryStandartsToDevices.deviceId, id));

        await tx
          .delete(measurementTypesToDevices)
          .where(eq(measurementTypesToDevices.deviceId, id));

        await tx.delete(verifications).where(eq(verifications.deviceId, id));

        const docsToDelete = await tx
          .select()
          .from(deviceDocuments)
          .where(eq(deviceDocuments.deviceId, id));

        for (const doc of docsToDelete) {
          const fileName = path.basename(doc.fileUrl);
          const fullFilePath = path.join(DOCUMENTS_DIR, fileName);

          filePathsToDiskDelete.push(fullFilePath);
        }

        const relatedBatches = await tx
          .select({ batchId: devicesToBatches.batchId })
          .from(devicesToBatches)
          .where(eq(devicesToBatches.deviceId, id));

        const batchIdsToCheck = relatedBatches.map((b) => b.batchId);

        await tx.delete(devices).where(eq(devices.id, id));

        if (batchIdsToCheck.length > 0) {
          // 1. Считаем, сколько приборов осталось в каждой из этих партий
          const remainingCounts = await tx
            .select({
              batchId: devicesToBatches.batchId,
              count: sql<number>`count(*)::int`,
            })
            .from(devicesToBatches)
            .where(inArray(devicesToBatches.batchId, batchIdsToCheck))
            .groupBy(devicesToBatches.batchId);

          // Находим те ID партий, которые всё еще имеют хотя бы 1 прибор
          const activeBatchIds = remainingCounts.map((r) => r.batchId);

          // 2. Вычисляем партии, которые стали абсолютно пустыми
          // (были в списке проверки, но их нет в списке активных)
          const emptyBatchIds = batchIdsToCheck.filter(
            (id) => !activeBatchIds.includes(id)
          );

          // 3. Если нашли пустые партии — удаляем их из базы данных
          if (emptyBatchIds.length > 0) {
            await tx
              .delete(verificationBatches)
              .where(inArray(verificationBatches.id, emptyBatchIds));
          }
        }
      });

      for (const filePath of filePathsToDiskDelete) {
        try {
          await fsPromises.access(filePath);
          await fsPromises.unlink(filePath);
        } catch (fileErr) {
          console.error(
            `Не удалось физически удалить файл ${filePath}:`,
            fileErr
          );
        }
      }

      // await this.db
      //   .update(devices)
      //   .set({
      //     archived: true,
      //     updatedAt: new Date()
      //   })
      //   .where(eq(devices.id, id));

      if (this.auditLogService) {
        await this.auditLogService.logAction({
          deviceId: id,
          action: 'delete',
          oldData: oldDataSnapshot,
          userId,
        });
      }
      return true;
    } catch (error) {
      throw new Error(
        'Не удалось удалить устройство. Попробуйте обновить страницу.'
      );
    }
  }

  async createVerification(input: CreateVerificationDto, userId: string) {
    let logDeviceData: any = null;
    const now = new Date();
    const oldDataSnapshot = await this.getFlatAuditSnapshot(input.deviceId);
    const newVerification = await this.db.transaction(async (tx) => {
      const [deviceExists] = await tx
        .select()
        .from(devices)
        .where(eq(devices.id, input.deviceId));

      if (!deviceExists) {
        throw new Error('Указанное оборудование не найдено в системе');
      }

      const [verificationRecord] = await tx
        .insert(verifications)
        .values({
          deviceId: input.deviceId,
          batchId: input.batchId ?? null,
          protocolNumber: input.protocolNumber,
          result: input.result,
          date: input.date,
          validUntil: input.validUntil ?? null,
          documentUrl: input.documentUrl ?? null,
          metrologyControleTypeId: input.metrologyControleTypeId,
          verificationOrganizationId: input.verificationOrganizationId,
          comment: input.comment ?? null,
          cost:
            input.cost !== undefined && input.cost !== null
              ? String(input.cost)
              : '0.00',
        })
        .returning();

      if (!verificationRecord) {
        throw new Error('Не удалось сохранить данные поверки');
      }

      let targetStatusId = deviceExists.statusId; // По умолчанию статус оставляем прежним

      if (input.result === 'Не годен') {
        const [rejectedStatus] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(sql`lower(trim(${statuses.name})) IN ('забракован')`);

        if (rejectedStatus) {
          targetStatusId = rejectedStatus.id;
        }
      } else if (input.result === 'Годен') {
        const [activeStatus] = await tx
          .select({ id: statuses.id })
          .from(statuses)
          .where(eq(sql`lower(trim(${statuses.name}))`, 'исправен'));

        if (activeStatus) {
          targetStatusId = activeStatus.id;
        }
      }

      await tx
        .update(devices)
        .set({ statusId: targetStatusId, updatedAt: now, updatedById: userId })
        .where(eq(devices.id, input.deviceId));

      logDeviceData = {
        name: deviceExists.name,
        model: deviceExists.model,
        serialNumber: deviceExists.serialNumber,
        cost: verificationRecord.cost ? parseFloat(verificationRecord.cost) : 0,
      };
      return verificationRecord;
    });
    const newDataSnapshot = await this.getFlatAuditSnapshot(input.deviceId);

    if (this.auditLogService && logDeviceData) {
      await this.auditLogService.logAction({
        deviceId: input.deviceId,
        action: 'verify',
        newData: {
          protocolNumber: input.protocolNumber,
          result: input.result,
          name: logDeviceData.name,
          model: logDeviceData.model,
          serialNumber: logDeviceData.serialNumber,
          cost: logDeviceData.cost,
        },
        userId,
      });
      if (oldDataSnapshot && newDataSnapshot) {
        await this.auditLogService.logAction({
          deviceId: input.deviceId,
          action: 'update',
          oldData: oldDataSnapshot,
          newData: newDataSnapshot,
          userId,
        });
      }
    }

    return newVerification;
  }

  async syncDeviceWithArshin(input: SyncDeviceWithArshinInput, userId: string) {
    const { deviceId, batchId } = input;

    // 1. Извлекаем прибор из базы для проверки номеров
    const [device] = await this.db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    if (!device) {
      throw new Error('Прибор не найден в системе');
    }

    if (!device.grsiNumber || !device.serialNumber) {
      throw new Error(
        'Синхронизация невозможна: у прибора в паспорте не заполнен номер ГРСИ или Серийный номер.'
      );
    }

    const [batch] = await this.db
      .select()
      .from(verificationBatches)
      .where(eq(verificationBatches.id, batchId))
      .limit(1);

    if (!batch) {
      throw new Error('Партия не найдена в системе');
    }

    const datePart = batch.plannedDate.toISOString().split('T')[0]!;

    const futureDate = new Date(batch.plannedDate.getTime());
    futureDate.setMonth(futureDate.getMonth() + 2);

    const datePlusTwoMonths = futureDate.toISOString().split('T')[0]!;

    const arshinService = new ArshinService();

    const arshinData = await arshinService.fetchLatestVerificationFromArshin(
      device.grsiNumber,
      device.serialNumber,
      datePart,
      datePlusTwoMonths
    );

    if (!arshinData) {
      throw new Error(
        `Сведения о поверке во ФГИС Аршин не найдены (Зав. №: ${device.serialNumber}, ГРСИ: ${device.grsiNumber}). Возможно, поверитель еще не опубликовал данные.`
      );
    }

    const [controlType] = await this.db
      .select()
      .from(metrologyControleTypes)
      .where(sql`lower(trim(${metrologyControleTypes.name})) = 'поверка'`)
      .limit(1);

    if (!controlType) {
      throw new Error(
        'В справочнике типов метрологического контроля не найден тип "Поверка". Проверьте наполнение базы.'
      );
    }

    let orgId: string;
    const [existingOrg] = await this.db
      .select()
      .from(verificationOrganizations)
      .where(
        eq(
          verificationOrganizations.name,
          arshinData.organizationName.toLowerCase()
        )
      )
      .limit(1);

    if (existingOrg) {
      orgId = existingOrg.id;
    } else {
      const insertedOrgs = await this.db
        .insert(verificationOrganizations)
        .values({ name: arshinData.organizationName.toLowerCase() })
        .returning();

      const newOrg = insertedOrgs[0];
      if (!newOrg) {
        throw new Error(
          'Не удалось сохранить поверяющую организацию в базу данных'
        );
      }
      orgId = newOrg.id;
    }

    const parseArshinDate = (
      dateStr: string | null | undefined
    ): Date | null => {
      if (!dateStr) return null;

      const parts = dateStr.split('.');
      if (parts.length !== 3) {
        const parsedDate = new Date(dateStr);
        return isNaN(parsedDate.getTime()) ? null : parsedDate;
      }

      const day = parseInt(parts[0] ?? '', 10);
      const month = parseInt(parts[1] ?? '', 10) - 1;
      const year = parseInt(parts[2] ?? '', 10);

      return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    };

    const parsedDate = parseArshinDate(arshinData.date);
    if (!parsedDate) {
      throw new Error(
        'Не удалось распарсить обязательную дату поверки из ФГИС Аршин'
      );
    }

    if (!deviceId || !controlType?.id || !orgId) {
      throw new Error(
        'Отсутствуют обязательные идентификаторы для привязки поверки'
      );
    }

    const verificationDto = {
      deviceId: deviceId,
      batchId: batchId ?? null,
      protocolNumber: arshinData.protocolNumber,
      result: arshinData.isApplicable ? 'Годен' : 'Не годен',
      documentUrl: arshinData.documentUrl,
      date: parsedDate,
      validUntil: parseArshinDate(arshinData.validUntil) ?? undefined,
      metrologyControleTypeId: controlType.id,
      verificationOrganizationId: orgId,
      comment: `Автоматическая синхронизация ФГИС Аршин. ID записи: ${arshinData.arshinId}`,
      cost: 0,
    };

    await this.createVerification(verificationDto, userId);

    await this.db
      .update(devicesToBatches)
      .set({ deviceStatus: 'returned' })
      .where(
        and(
          eq(devicesToBatches.deviceId, deviceId),
          eq(devicesToBatches.batchId, batchId)
        )
      );

    return device;
  }

  async syncBatchWithArshin(batchId: string, userId: string) {
    const job = await arshinQueue.add('sync-batch', { batchId, userId });

    return {
      jobId: job.id,
      batchId,
      message: 'Синхронизация запущена в фоновом режиме',
    };
  }

  // async syncBatchWithArshin(batchId: string, userId: string) {
  //   const delay = (ms: number) =>
  //     new Promise((resolve) => setTimeout(resolve, ms));
  //   const pendingLinks = await this.db
  //     .select({
  //       deviceId: devicesToBatches.deviceId,
  //     })
  //     .from(devicesToBatches)
  //     .where(
  //       and(
  //         eq(devicesToBatches.batchId, batchId),
  //         ne(devicesToBatches.deviceStatus, 'returned')
  //       )
  //     );

  //   const totalCount = pendingLinks.length;

  //   let syncedCount = 0;
  //   const details = [];

  //   if (totalCount === 0) {
  //     return {
  //       batchId,
  //       syncedCount: 0,
  //       totalCount: 0,
  //       details: [],
  //     };
  //   }

  //   // for (const link of pendingLinks) {
  //   for (let i = 0; i < pendingLinks.length; i++) {
  //     const link = pendingLinks[i]!;
  //     try {
  //       if (i > 0) {
  //         await delay(600);
  //       }
  //       await this.syncDeviceWithArshin(
  //         { deviceId: link.deviceId, batchId },
  //         userId
  //       );

  //       syncedCount++;
  //       details.push({
  //         deviceId: link.deviceId,
  //         success: true,
  //         message: 'Успешно синхронизирован с ФГИС Аршин',
  //       });
  //     } catch (error: any) {
  //       details.push({
  //         deviceId: link.deviceId,
  //         success: false,
  //         message: error.message || 'Неизвестная ошибка при запросе к Аршин',
  //       });
  //     }
  //   }

  //   return {
  //     batchId,
  //     syncedCount,
  //     totalCount,
  //     details,
  //   };
  // }
  // Внутри вашего класса DeviceService
  async executeBatchArshinSync(
    batchId: string,
    userId: string,
    onProgress?: (synced: number, total: number) => Promise<void>
  ) {
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const pendingLinks = await this.db
      .select({ deviceId: devicesToBatches.deviceId })
      .from(devicesToBatches)
      .where(
        and(
          eq(devicesToBatches.batchId, batchId),
          ne(devicesToBatches.deviceStatus, 'returned')
        )
      );

    const totalCount = pendingLinks.length;
    let syncedCount = 0;
    const details: Array<{
      deviceId: string;
      success: boolean;
      message: string;
    }> = [];

    if (totalCount === 0) {
      return { batchId, syncedCount: 0, totalCount: 0, details };
    }

    for (let i = 0; i < pendingLinks.length; i++) {
      const link = pendingLinks[i]!;
      try {
        if (i > 0) {
          await delay(600);
        }
        await this.syncDeviceWithArshin(
          { deviceId: link.deviceId, batchId },
          userId
        );
        syncedCount++;
        details.push({
          deviceId: link.deviceId,
          success: true,
          message: 'Успешно синхронизирован с ФГИС Аршин',
        });
      } catch (error: any) {
        details.push({
          deviceId: link.deviceId,
          success: false,
          message: error.message || 'Неизвестная ошибка при запросе к Аршин',
        });
      }

      // 🔥 ВЫЗЫВАЕМ КОЛБЭК ПРОГРЕССА ПОСЛЕ КАЖДОГО ПРИБОРА
      if (onProgress) {
        // Передаем текущий шаг и общее количество
        await onProgress(i + 1, totalCount);
      }
    }

    return { batchId, syncedCount, totalCount, details };
  }

  async importDevicesFromExcel(
    items: ImportDeviceItem[],
    userId: string
  ): Promise<number> {
    let importedCount = 0;

    const parseMultipleNames = (
      rawString: string | null | undefined
    ): string[] => {
      if (!rawString) return [];

      return (
        rawString
          // 🎯 РЕГУЛЯРКА-ВСЕЯДНАЯ:
          // [,;/|\n\r]+ означает деление по запятой, точке с запятой, косой черте, вертикальной черте или ЛЮБОМУ переносу строки
          .split(/[,;/|\n\r]+/)
          .map((name) => name.trim())
          // Дополнительно отсекаем пустые элементы и пробельные строки
          .filter((name) => name.length > 0)
      );
    };

    await this.db.transaction(async (tx) => {
      const cityCache = new Map<string, string>(); // name -> id
      const companyCache = new Map<string, string>(); // name -> id
      const siteCache = new Map<string, string>(); // "companyId_cityId_name" -> id
      const statusCache = new Map<string, string>(); // name -> id
      const typeCache = new Map<string, string>(); // name -> id
      const scopeCache = new Map<string, string>(); // name -> id
      const measTypeCache = new Map<string, string>(); // name -> id
      const standardCache = new Map<string, string>(); // name -> id

      for (const item of items) {
        const normCity = item.cityName.trim();
        const normCompany = item.companyName.trim();
        const normSite = item.productionSiteName.trim();
        const normStatus = item.statusName.trim();
        const normType = item.equipmentTypeName?.trim();

        // 1. Разруливаем Город (City)
        let cityId = cityCache.get(normCity.toLowerCase());
        if (!cityId) {
          const [existing] = await tx
            .select()
            .from(cities)
            .where(eq(sql`lower(${cities.name})`, normCity.toLowerCase()))
            .limit(1);
          if (existing) {
            cityId = existing.id;
          } else {
            const insertedCities = await tx
              .insert(cities)
              .values({ name: normCity.toLowerCase() })
              .returning();
            // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
            const inserted = insertedCities[0];
            if (!inserted)
              throw new Error(`Не удалось создать город: ${normCity}`);
            cityId = inserted.id;
          }
          cityCache.set(normCity.toLowerCase(), cityId);
        }

        // 2. Разруливаем Компания (Company)
        let companyId = companyCache.get(normCompany.toLowerCase());
        if (!companyId) {
          const [existing] = await tx
            .select()
            .from(companies)
            .where(eq(sql`lower(${companies.name})`, normCompany.toLowerCase()))
            .limit(1);
          if (existing) {
            companyId = existing.id;
          } else {
            const insertedCompanies = await tx
              .insert(companies)
              .values({ name: normCompany.toLowerCase() })
              .returning();
            // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
            const inserted = insertedCompanies[0];
            if (!inserted)
              throw new Error(`Не удалось создать компанию: ${normCompany}`);
            companyId = inserted.id;
          }
          companyCache.set(normCompany.toLowerCase(), companyId);
        }

        // 3. Разруливаем Площадку (Production Site)
        const siteKey = `${companyId}_${cityId}_${normSite.toLowerCase()}`;
        let siteId = siteCache.get(siteKey);
        if (!siteId) {
          const [existing] = await tx
            .select()
            .from(productionSites)
            .where(
              and(
                eq(productionSites.companyId, companyId),
                eq(productionSites.cityId, cityId),
                eq(sql`lower(${productionSites.name})`, normSite.toLowerCase())
              )
            )
            .limit(1);

          if (existing) {
            siteId = existing.id;
          } else {
            const insertedSites = await tx
              .insert(productionSites)
              .values({
                name: normSite.toLowerCase(),
                companyId,
                cityId,
              })
              .returning();
            // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
            const inserted = insertedSites[0];
            if (!inserted)
              throw new Error(`Не удалось создать площадку: ${normSite}`);
            siteId = inserted.id;
          }
          siteCache.set(siteKey, siteId);
        }

        // 4. Разруливаем Статус (Status)
        let statusId = statusCache.get(normStatus.toLowerCase());
        if (!statusId) {
          const [existing] = await tx
            .select()
            .from(statuses)
            .where(eq(sql`lower(${statuses.name})`, normStatus.toLowerCase()))
            .limit(1);
          if (existing) {
            statusId = existing.id;
          } else {
            const insertedStatuses = await tx
              .insert(statuses)
              .values({ name: normStatus.toLowerCase() })
              .returning();
            // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
            const inserted = insertedStatuses[0];
            if (!inserted)
              throw new Error(`Не удалось создать статус: ${normStatus}`);
            statusId = inserted.id;
          }
          statusCache.set(normStatus.toLowerCase(), statusId);
        }

        // 5. Разруливаем Тип оборудования (Equipment Type) - опционально
        let equipmentTypeId: string | null = null;
        if (normType) {
          equipmentTypeId = typeCache.get(normType.toLowerCase()) || null;
          if (!equipmentTypeId) {
            const [existing] = await tx
              .select()
              .from(equipmentTypes)
              .where(
                eq(sql`lower(${equipmentTypes.name})`, normType.toLowerCase())
              )
              .limit(1);
            if (existing) {
              equipmentTypeId = existing.id;
            } else {
              const insertedTypes = await tx
                .insert(equipmentTypes)
                .values({ name: normType.toLowerCase() })
                .returning();
              // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
              const inserted = insertedTypes[0];
              if (!inserted)
                throw new Error(
                  `Не удалось создать тип оборудования: ${normType}`
                );
              equipmentTypeId = inserted.id;
            }
            if (equipmentTypeId)
              typeCache.set(normType.toLowerCase(), equipmentTypeId);
          }
        }

        // 6. Проверяем дубликат прибора по серийному номеру и модели, чтобы не плодить копии
        const [duplicate] = await tx
          .select()
          .from(devices)
          .where(
            and(
              eq(
                sql`lower(${devices.serialNumber})`,
                item.serialNumber.trim().toLowerCase()
              ),
              eq(sql`lower(${devices.model})`, item.model.trim().toLowerCase())
            )
          )
          .limit(1);

        if (duplicate) {
          // Если такой прибор уже есть — просто пропускаем его, либо обновляем (мы пропустим)
          continue;
        }

        // 7. Безопасный парсинг интервала поверки (МПИ)
        const parsedInterval = item.verificationInterval
          ? parseInt(item.verificationInterval, 10)
          : null;

        // 8. Вставляем прибор в базу
        const [newDevice] = await tx
          .insert(devices)
          .values({
            name: item.name.trim(),
            model: item.model.trim(),
            serialNumber: item.serialNumber.trim(),
            grsiNumber: item.grsiNumber?.trim() || null,
            inventoryNumber: item.inventoryNumber?.trim() || null,
            manufacturer: item.manufacturer?.trim() || null,
            verificationInterval: isNaN(parsedInterval as number)
              ? null
              : parsedInterval,
            nomenclature: item.nomenclature?.trim() || null,
            comment: item.comment?.trim() || null,
            statusId: statusId!,
            productionSiteId: siteId!,
            equipmentTypeId: equipmentTypeId,
            archived: false,
            measurementRange: item.measurementRange?.trim() || null,
            accuracy: item.accuracy?.trim() || null,
          })
          .returning();

        if (!newDevice)
          throw new Error(`Не удалось создать прибор: ${item.name}`);
        const deviceId = newDevice.id;

        // 🎯 2. РАЗРУЛИВАЕМ СФЕРЫ ГОСРЕГУЛИРОВАНИЯ (Many-to-Many)
        const targetScopes = parseMultipleNames(item.scopesNames);
        for (const scopeName of targetScopes) {
          let scopeId = scopeCache.get(scopeName.toLowerCase());
          if (!scopeId) {
            const [existing] = await tx
              .select()
              .from(scopes)
              .where(eq(sql`lower(${scopes.name})`, scopeName.toLowerCase()))
              .limit(1);
            if (existing) {
              scopeId = existing.id;
            } else {
              const insertedScopes = await tx
                .insert(scopes)
                .values({ name: scopeName.toLowerCase() })
                .returning();
              // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
              const inserted = insertedScopes[0];
              if (!inserted)
                throw new Error(
                  `Не удалось создать сферу регулирования: ${scopeName}`
                );
              scopeId = inserted.id;
            }
            scopeCache.set(scopeName.toLowerCase(), scopeId);
          }
          // Записываем связь в промежуточную таблицу
          await tx
            .insert(scopesToDevices)
            .values({ deviceId, scopeId })
            .onConflictDoNothing();
        }

        // 🎯 3. РАЗРУЛИВАЕМ ВИДЫ ИЗМЕРЕНИЙ (Many-to-Many)
        const targetMeasTypes = parseMultipleNames(item.measurementTypesNames);
        for (const mTypeName of targetMeasTypes) {
          let mTypeId = measTypeCache.get(mTypeName.toLowerCase());
          if (!mTypeId) {
            const [existing] = await tx
              .select()
              .from(measurementTypes)
              .where(
                eq(
                  sql`lower(${measurementTypes.name})`,
                  mTypeName.toLowerCase()
                )
              )
              .limit(1);
            if (existing) {
              mTypeId = existing.id;
            } else {
              const insertedTypes = await tx
                .insert(measurementTypes)
                .values({ name: mTypeName.toLowerCase() })
                .returning();
              // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
              const inserted = insertedTypes[0];
              if (!inserted)
                throw new Error(
                  `Не удалось создать вид измерений: ${mTypeName}`
                );
              mTypeId = inserted.id;
            }
            measTypeCache.set(mTypeName.toLowerCase(), mTypeId);
          }
          // Записываем связь в промежуточную таблицу
          await tx
            .insert(measurementTypesToDevices)
            .values({ deviceId, measurementTypeId: mTypeId })
            .onConflictDoNothing();
        }

        // 🎯 4. РАЗРУЛИВАЕМ ПЕРВИЧНЫЕ ЭТАЛОНЫ (Many-to-Many)
        const targetStandards = parseMultipleNames(item.primaryStandardsNames);
        for (const stdName of targetStandards) {
          let stdId = standardCache.get(stdName.toLowerCase());
          if (!stdId) {
            const [existing] = await tx
              .select()
              .from(primaryStandarts)
              .where(
                eq(sql`lower(${primaryStandarts.name})`, stdName.toLowerCase())
              )
              .limit(1);
            if (existing) {
              stdId = existing.id;
            } else {
              const insertedStandards = await tx
                .insert(primaryStandarts)
                .values({ name: stdName.toLowerCase() })
                .returning();
              // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
              const inserted = insertedStandards[0];
              if (!inserted)
                throw new Error(
                  `Не удалось создать первичный эталон: ${stdName}`
                );
              stdId = inserted.id;
            }
            standardCache.set(stdName.toLowerCase(), stdId);
          }
          // Записываем связь в промежуточную таблицу
          await tx
            .insert(primaryStandartsToDevices)
            .values({ deviceId, primaryStandartId: stdId })
            .onConflictDoNothing();
        }

        importedCount++;
      }
    });

    // Запись общего действия в лог аудита (опционально, можно расширить лог на каждый прибор)
    // if (this.auditLogService && importedCount > 0) {
    //   await this.auditLogService.logAction({
    //     action: 'create',
    //     description: `Выполнен пакетный импорт приборов из Excel. Успешно загружено: ${importedCount} шт.`,
    //     userId,
    //   });
    // }

    return importedCount;
  }

  async executeRawSql(sqlQuery: string) {
    try {
      // Выполняем сырой SQL запрос через Drizzle
      const result = await this.db.execute(sql.raw(sqlQuery));

      // Приводим результат к массиву строк для универсальности
      const rows = Array.isArray(result.rows)
        ? result.rows
        : Array.isArray(result)
        ? result
        : [];

      // Динамически вытаскиваем названия колонок из первого полученного объекта
      const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];

      // 🎯 ИСПРАВЛЕНИЕ ts(2339): Безопасно проверяем наличие rowCount в объекте,
      // либо берем длину массива rows, если это был обычный SELECT запрос
      let affectedRows = rows.length;
      if (result && typeof result === 'object' && 'rowCount' in result) {
        affectedRows = (result as any).rowCount ?? rows.length;
      }

      return {
        success: true,
        columns,
        rows,
        affectedRows,
        errorMessage: null,
      };
    } catch (error: any) {
      return {
        success: false,
        columns: [],
        rows: [],
        affectedRows: 0,
        errorMessage:
          error.message ||
          'Критическая ошибка базы данных при выполнении запроса',
      };
    }
  }

  // async getDevicesBarcodeData(ids: string[]) {
  //   if (!ids || ids.length === 0) return [];

  //   const cleanIds = ids.map((id) => id.toLowerCase().trim());

  //   return await this.db
  //     .select({
  //       id: devices.id,
  //       name: devices.name,
  //       model: devices.model,
  //       serialNumber: devices.serialNumber,
  //       statusName: statuses.name,
  //       controlType: metrologyControleTypes.name,
  //       validUntil: verifications.validUntil,
  //     })
  //     .from(devices)
  //     .leftJoin(statuses, eq(devices.statusId, statuses.id))
  //     .leftJoin(
  //       verifications,
  //       and(
  //         eq(verifications.deviceId, devices.id),
  //         eq(
  //           verifications.date,
  //           sql`(SELECT MAX(date) FROM verifications WHERE device_id = ${devices.id})`
  //         )
  //       )
  //     )
  //     .leftJoin(
  //       metrologyControleTypes,
  //       eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
  //     )
  //     .where(inArray(devices.id, cleanIds));
  // }

  async getDevicesBarcodeData(input: PrintBarcodesInput) {
    // const { deviceIds, controlType, historyLinkIds } = input;
    const { deviceIds, historyLinkIds } = input;
    const results: any[] = [];

    // ВЕТКА А: ПЕЧАТЬ ИЗ АРХИВА (По явным ID связей из devices_to_batches)
    if (historyLinkIds && historyLinkIds.length > 0) {
      const cleanLinkIds = historyLinkIds.map((id) => id.toLowerCase().trim());

      const archiveRecords = await this.db
        .select({
          id: devicesToBatches.id, // ID самой связи, чтобы Apollo закэшировал строку
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
          statusName: sql<string>`CASE WHEN ${verifications.result} = 'Годен' THEN 'исправен' ELSE 'неисправен' END`,
          // controlType: sql<string>`CASE WHEN ${verificationBatches.type} = 'inspection' THEN 'осмотр' ELSE 'поверка' END`,
          controlType: metrologyControleTypes.name,
          validUntil: verifications.validUntil,
        })
        .from(devicesToBatches)
        .leftJoin(devices, eq(devicesToBatches.deviceId, devices.id))
        .leftJoin(statuses, eq(devices.statusId, statuses.id))
        .leftJoin(
          verificationBatches,
          eq(devicesToBatches.batchId, verificationBatches.id)
        )
        // Привязываемся к verifications строго по совпадению deviceId и batchId!
        .leftJoin(
          verifications,
          and(
            eq(verifications.deviceId, devicesToBatches.deviceId),
            eq(verifications.batchId, devicesToBatches.batchId)
          )
        )
        .leftJoin(
          metrologyControleTypes,
          eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
        )

        .where(inArray(devicesToBatches.id, cleanLinkIds));

      results.push(...archiveRecords);
    }

    // ВЕТКА Б: УМНАЯ ПЕЧАТЬ С ГЛАВНОЙ СТРАНИЦЫ (По чистым ID приборов)
    if (deviceIds && deviceIds.length > 0) {
      const cleanDeviceIds = deviceIds.map((id) => id.toLowerCase().trim());

      for (const deviceId of cleanDeviceIds) {
        let typeConditionSql = '';

        // 🎯 ЛОГИКА АВТОМАТИКИ НА СЕРВЕРЕ:
        // Если фронтенд НЕ передал controlType (печать с главной страницы)
        // if (!controlType) {
        // Делаем экспресс-проверку прибора в БД: относится ли он к сфере госрегулирования (СИ)?
        // Например, проверяем имя типа оборудования. Настройте это условие под вашу БД.
        const [deviceCheck] = await this.db
          .select({
            typeName: equipmentTypes.name,
            grsiNumber: devices.grsiNumber,
          })
          .from(devices)
          .leftJoin(
            equipmentTypes,
            eq(devices.equipmentTypeId, equipmentTypes.id)
          )
          .where(eq(devices.id, deviceId));

        const deviceScopesData = await this.db
          .select({ scopeName: scopes.name })
          .from(scopesToDevices)
          .leftJoin(scopes, eq(scopesToDevices.scopeId, scopes.id))
          .where(eq(scopesToDevices.deviceId, deviceId));

        const eqTypeName = deviceCheck?.typeName?.toLowerCase().trim() ?? '';
        const deviceScopes = deviceScopesData.map(
          (s) => s.scopeName?.toLowerCase().trim() ?? ''
        );

        const hasGrsi =
          !!deviceCheck?.grsiNumber && deviceCheck.grsiNumber.trim() !== '';

        const isNotGr =
          deviceScopes.includes('не гр') ||
          deviceScopes.includes(
            'вне сферы государственного регулирования (не гр)'
          );

        let targetControlName = 'осмотр';

        if (
          eqTypeName === 'индикатор' ||
          eqTypeName === 'вспомогательное оборудование (во)'
        ) {
          // Индикаторы и ВО — это всегда осмотр без исключений
          targetControlName = 'осмотр';
        } else if (eqTypeName === 'средство измерений (си)') {
          // СИ: Если есть ГРСИ И при этом (сферы пустые ИЛИ сфера точно НЕ "не ГР") -> ПОВЕРКА.
          // Во всех остальных случаях (есть "не ГР" ИЛИ нет ГРСИ) -> ОСМОТР.
          if (hasGrsi && !isNotGr) {
            targetControlName = 'поверка';
          } else {
            targetControlName = 'осмотр';
          }
        } else if (eqTypeName === 'средство контроля (ск)') {
          console.log('2', eqTypeName);
          // СК: Если сфера "не ГР" -> ОСМОТР.
          if (isNotGr) {
            console.log('3', isNotGr);
            targetControlName = 'осмотр';
          } else {
            console.log('4', hasGrsi);
            // Если другая сфера или пусто: смотрим на ГРСИ. Есть ГРСИ -> ПОВЕРКА, нет ГРСИ -> КАЛИБРОВКА.
            targetControlName = hasGrsi ? 'поверка' : 'калибровка';
          }
        } else if (eqTypeName === 'испытательное оборудование (ио)') {
          // ИО: Если сфера "не ГР" -> ОСМОТР. Если нет "не ГР" или пусто -> АТТЕСТАЦИЯ.
          targetControlName = isNotGr ? 'осмотр' : 'аттестация';
        }

        // Формируем SQL-условие для подзапроса MAX(date)
        typeConditionSql = `AND LOWER(mct.name) = '${targetControlName}'`;
        // } else {
        //   // Если фронтенд жестко передал тип (из конкретных журналов) — используем его напрямую
        //   typeConditionSql = `AND LOWER(mct.name) = '${controlType
        //     .toLowerCase()
        //     .trim()}'`;
        // }

        // Вытаскиваем данные прибора с учетом вычисленного условия typeCondition
        const [deviceRecord] = await this.db
          .select({
            id: devices.id,
            name: devices.name,
            model: devices.model,
            serialNumber: devices.serialNumber,
            statusName: sql<string>`CASE WHEN ${verifications.result} = 'Годен' THEN 'исправен' ELSE 'неисправен' END`,
            controlType: metrologyControleTypes.name,
            validUntil: verifications.validUntil,
          })
          .from(devices)
          .leftJoin(statuses, eq(devices.statusId, statuses.id))
          .leftJoin(
            verifications,
            and(
              eq(verifications.deviceId, devices.id),
              // eq(
              //   verifications.date,
              //   sql`(
              //     SELECT MAX(v.date)
              //     FROM verifications v
              //     LEFT JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
              //     WHERE v.device_id = ${devices.id} ${sql.raw(typeConditionSql)}
              //   )`
              // )
              eq(
                verifications.id,
                sql`(
                  SELECT v.id
                  FROM verifications v
                  LEFT JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
                  WHERE v.device_id = ${devices.id} ${sql.raw(typeConditionSql)}
                  ORDER BY v.date DESC, v.id DESC
                  LIMIT 1
                )`
              )
            )
          )
          .leftJoin(
            metrologyControleTypes,
            eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
          )
          .where(eq(devices.id, deviceId));

        if (deviceRecord) {
          results.push(deviceRecord);
        }
      }
    }

    return results;
  }
}
