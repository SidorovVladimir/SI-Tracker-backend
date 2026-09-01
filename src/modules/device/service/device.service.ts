import { and, eq, ilike, inArray, isNull, ne, or, sql, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity } from '../types/device.types';
import { deviceDocuments, devices } from '../models/device.model';
import { scopes, scopesToDevices } from '../../catalog/models/scope.model';

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
import {
  verifications,
  arshinVerificationBuffer,
  devicesToBatches,
  verificationBatches,
} from '../../verification/models/verification.model';

export interface PrintBarcodesInput {
  deviceIds?: string[];
  controlType?: string;
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
    const conditions = [];

    // 1. Фильтр архива (Мгновенный по B-Tree индексу)
    if (filter?.includeArchived !== true) {
      conditions.push(eq(devices.archived, filter?.archived === true));
    }

    // 2. Текстовые фильтры (Обычный ILIKE по подстроке)
    if (filter?.deviceName) {
      conditions.push(ilike(devices.name, `%${filter.deviceName}%`));
    }
    if (filter?.serialNumber) {
      conditions.push(ilike(devices.serialNumber, `%${filter.serialNumber}%`));
    }

    // Утилита очистки строк на бэкенде (база больше не тратит ресурсы на LOWER и TRIM)
    const cleanStr = (val: any) =>
      typeof val === 'string' ? val.trim().toLowerCase() : null;

    // 3. Фильтры по справочникам (Прямое и быстрое сравнение по индексам, в БД всё в LOWER)
    if (filter?.status) {
      conditions.push(
        sql`${
          devices.statusId
        } IN (SELECT id FROM statuses WHERE name = ${cleanStr(filter.status)})`
      );
    }
    if (filter?.productionSite) {
      conditions.push(
        sql`${
          devices.productionSiteId
        } IN (SELECT id FROM production_sites WHERE name = ${cleanStr(
          filter.productionSite
        )})`
      );
    }
    if (filter?.city) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
        SELECT ps.id FROM production_sites ps
        JOIN cities c ON ps.city_id = c.id
        WHERE c.name = ${cleanStr(filter.city)}
      )`
      );
    }
    if (filter?.company) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
        SELECT ps.id FROM production_sites ps
        JOIN companies comp ON ps.company_id = comp.id
        WHERE comp.name = ${cleanStr(filter.company)}
      )`
      );
    }

    // 4. МГНОВЕННЫЙ ФИЛЬТР МЕТРОЛОГИИ (По нашим новым кэш-колонкам)
    const isInspectionFilter = cleanStr(filter?.metrologyControle) === 'осмотр';

    if (filter?.metrologyControle) {
      conditions.push(
        eq(devices.cachedControl, cleanStr(filter.metrologyControle)!)
      );
    }
    // if (filter?.dateStart) {
    //   conditions.push(
    //     sql`${devices.nextVerificationDate} >= ${String(filter.dateStart).slice(
    //       0,
    //       10
    //     )}`
    //   );
    // }
    // if (filter?.dateEnd) {
    //   conditions.push(
    //     sql`${devices.nextVerificationDate} <= ${String(filter.dateEnd).slice(
    //       0,
    //       10
    //     )}`
    //   );
    // }
    const dateColumnSql = isInspectionFilter
      ? devices.nextInspectionDate
      : devices.nextVerificationDate;

    if (filter?.dateStart) {
      conditions.push(
        sql`${dateColumnSql} >= ${String(filter.dateStart).slice(0, 10)}`
      );
    }
    if (filter?.dateEnd) {
      conditions.push(
        sql`${dateColumnSql} <= ${String(filter.dateEnd).slice(0, 10)}`
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 5. Оптимизированный подсчет количества (Без тяжелых подзапросов)
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(devices)
      .where(whereClause);

    // 6. Получение данных (Выгребаем максимум 2 записи верификаций на прибор: целевую и осмотр)
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
        cachedControl: true, // Забираем значение кэша для маппинга
        nextVerificationDate: true, // Вытягиваем кэш метрологии
        nextInspectionDate: true,
      },
      with: {
        status: { columns: { name: true } },
        productionSite: {
          columns: { name: true },
          with: {
            city: { columns: { name: true } },
            company: { columns: { name: true } },
          },
        },
        verifications: {
          orderBy: (v) => [sql`${v.date} DESC NULLS LAST`],
          limit: 5, // Ограничиваем выборку истории в памяти Node.js
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

    // 7. Легкий маппинг без тяжелых JS-вычислений массивов
    return {
      items: items.map((d) => {
        // Находим среди выгруженных записей ту, что совпадает с вычисленным типом контроля
        const targetControl =
          d.verifications.find(
            (v) => v.metrologyControleType?.name === d.cachedControl
          ) || null;

        // Находим осмотр для выделенной колонки
        const absoluteLatestInspection =
          d.verifications.find(
            (v) => v.metrologyControleType?.name === 'осмотр'
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
          latestVerification: targetControl,
          cachedControl: d.cachedControl,
          latestInspection: absoluteLatestInspection,
          nextVerificationDate: d.nextVerificationDate,
          nextInspectionDate: d.nextInspectionDate,
        };
      }),
      totalCount: countResult?.count ?? 0,
    };
  }

  async getDevice(id: string) {
    // ПОТОК 1: Забираем только плоские данные прибора и его прямые связи 1-к-1
    // Это отработает мгновенно по первичному ключу
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, id),
      columns: {
        id: true,
        name: true,
        model: true,
        serialNumber: true,
        releaseDate: true,
        grsiNumber: true,
        csmCode: true,
        measurementRange: true,
        accuracy: true,
        inventoryNumber: true,
        receiptDate: true,
        manufacturer: true,
        verificationInterval: true,
        archived: true,
        nomenclature: true,
        comment: true,
        leadTimeDays: true,
        statusId: true,
        productionSiteId: true,
        equipmentTypeId: true,
        createdAt: true,
        updatedAt: true,
        createdById: true,
        updatedById: true,
        nextInspectionDate: true,
      },
      with: {
        status: { columns: { id: true, name: true } },
        equipmentType: { columns: { id: true, name: true } },
        createdBy: {
          columns: { id: true, firstName: true, lastName: true, role: true },
        }, // или какие поля вам нужны
        updatedBy: {
          columns: { id: true, firstName: true, lastName: true, role: true },
        },
        productionSite: {
          columns: { id: true, name: true },
          with: {
            city: { columns: { id: true, name: true } },
            company: { columns: { id: true, name: true } },
          },
        },
      },
    });

    if (!data) return null;

    // ПОТОК 2: Параллельно забираем все массивы связей МНОГИЕ-КО-МНОГИМ и документы
    // Запросы выполняются одновременно (Promise.all), используя индексы deviceId
    const [
      dbScopes,
      dbStandarts,
      dbMeasurements,
      dbVerifications,
      dbDocuments,
    ] = await Promise.all([
      // Сферы
      this.db.query.scopesToDevices.findMany({
        where: eq(scopesToDevices.deviceId, id),
        with: { scope: true },
      }),
      // Эталоны
      this.db.query.primaryStandartsToDevices.findMany({
        where: eq(primaryStandartsToDevices.deviceId, id),
        with: { primaryStandart: true },
      }),
      // Виды измерений
      this.db.query.measurementTypesToDevices.findMany({
        where: eq(measurementTypesToDevices.deviceId, id),
        with: { measurementType: true },
      }),
      // Верификации (сортируем в БД)
      this.db.query.verifications.findMany({
        where: eq(verifications.deviceId, id),
        orderBy: (v, { asc }) => [asc(v.validUntil)],
        with: {
          metrologyControleType: { columns: { id: true, name: true } },
          verificationOrganization: { columns: { id: true, name: true } },
        },
      }),
      // Документы конкретного прибора (Паспорта)
      this.db.query.deviceDocuments.findMany({
        where: eq(deviceDocuments.deviceId, id),
      }),
    ]);

    // ПОТОК 3: Чистый, оптимизированный поиск руководств (РЭ) по модели/ГРСИ
    // Убираем сложные динамические `or(undefined)`, пишем жесткое и понятное для Postgres условие
    const manualDocsConditions = [];

    if (data.grsiNumber && data.model) {
      // Сценарий для СИ: совпадает ГРСИ + Модель, прибор пустой
      manualDocsConditions.push(
        and(
          eq(deviceDocuments.grsiNumber, data.grsiNumber),
          eq(deviceDocuments.modelName, data.model),
          isNull(deviceDocuments.deviceId)
        )
      );
    } else if (data.model) {
      // Сценарий для ИО/ВО: совпадает только Модель, ГРСИ и прибор пустые
      manualDocsConditions.push(
        and(
          eq(deviceDocuments.modelName, data.model),
          isNull(deviceDocuments.grsiNumber),
          isNull(deviceDocuments.deviceId)
        )
      );
    }

    // Делаем запрос за РЭ только если сформировались условия
    const manualDocs =
      manualDocsConditions.length > 0
        ? await this.db.query.deviceDocuments.findMany({
            where: or(...manualDocsConditions),
          })
        : [];

    // Разворачиваем плоские массивы, сохраняя исходный контракт фронтенда
    const scopes = dbScopes.map((sd) => sd.scope).filter(Boolean);
    const primaryStandarts = dbStandarts
      .map((psd) => psd.primaryStandart)
      .filter(Boolean);
    const measurementTypes = dbMeasurements
      .map((mt) => mt.measurementType)
      .filter(Boolean);
    const allDocuments = [...dbDocuments, ...manualDocs];

    // Возвращаем объект в том же формате, что ожидает фронтенд и аудит-лог
    return {
      ...data,
      scopes,
      primaryStandarts,
      measurementTypes,
      verifications: dbVerifications,
      documents: allDocuments,
    };
  }

  async getFlatAuditSnapshot(deviceId: string) {
    // Запускаем два независимых индексных запроса параллельно
    const [deviceRows, verificationRows] = await Promise.all([
      // Запрос 1: Основные характеристики прибора и связи многие-ко-многим
      this.db
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
          grsiNumber: devices.grsiNumber,
          csmCode: devices.csmCode,
          accuracy: devices.accuracy,
          inventoryNumber: devices.inventoryNumber,
          verificationInterval: devices.verificationInterval,
          archived: devices.archived,
          manufacturer: devices.manufacturer,
          statusName: statuses.name,
          equipmentTypeName: equipmentTypes.name,
          siteName: productionSites.name,
          cityName: cities.name,
          companyName: companies.name,
          scopeName: scopes.name,
          measurementName: measurementTypes.name,
        })
        .from(devices)
        .leftJoin(statuses, eq(devices.statusId, statuses.id))
        .leftJoin(
          equipmentTypes,
          eq(devices.equipmentTypeId, equipmentTypes.id)
        )
        .leftJoin(
          productionSites,
          eq(devices.productionSiteId, productionSites.id)
        )
        .leftJoin(cities, eq(productionSites.cityId, cities.id))
        .leftJoin(companies, eq(productionSites.companyId, companies.id))
        .leftJoin(scopesToDevices, eq(scopesToDevices.deviceId, devices.id))
        .leftJoin(scopes, eq(scopesToDevices.scopeId, scopes.id))
        .leftJoin(
          measurementTypesToDevices,
          eq(measurementTypesToDevices.deviceId, devices.id)
        )
        .leftJoin(
          measurementTypes,
          eq(measurementTypesToDevices.measurementTypeId, measurementTypes.id)
        )
        .where(eq(devices.id, deviceId)),

      this.db
        .select({
          id: verifications.id,
          date: verifications.date,
          validUntil: verifications.validUntil,
          result: verifications.result,
          protocolNumber: verifications.protocolNumber,
          comment: verifications.comment,
          documentUrl: verifications.documentUrl,
          controlTypeName: metrologyControleTypes.name,
          orgName: verificationOrganizations.name,
        })
        .from(verifications)
        .leftJoin(
          metrologyControleTypes,
          eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
        )
        .leftJoin(
          verificationOrganizations,
          eq(
            verifications.verificationOrganizationId,
            verificationOrganizations.id
          )
        )
        .where(eq(verifications.deviceId, deviceId))
        .orderBy(asc(verifications.validUntil)),
    ]);

    // Если прибор не найден в базе данных
    if (!deviceRows || deviceRows.length === 0) return null;

    // Так как при leftJoin строки дублируются из-за связей многие-ко-многим,
    // берем параметры самого прибора из первой строки
    const firstRow = deviceRows[0]!;

    // Схлопываем дубликаты строк в чистые уникальные массивы на стороне Node.js (работает мгновенно)
    const uniqueScopes = new Set<string>();
    const uniqueMeasurements = new Set<string>();

    for (const row of deviceRows) {
      if (row.scopeName) uniqueScopes.add(row.scopeName);
      if (row.measurementName) uniqueMeasurements.add(row.measurementName);
    }

    // Возвращаем плоский снимок в точно таком же контракте, какой ожидает ваш AuditLogService
    return {
      id: firstRow.id,
      name: firstRow.name,
      model: firstRow.model,
      serialNumber: firstRow.serialNumber,
      grsiNumber: firstRow.grsiNumber,
      csmCode: firstRow.csmCode,
      accuracy: firstRow.accuracy,
      inventoryNumber: firstRow.inventoryNumber,
      verificationInterval: firstRow.verificationInterval,
      archived: firstRow.archived,
      manufacturer: firstRow.manufacturer,
      status: firstRow.statusName || 'не указан',
      equipmentType: firstRow.equipmentTypeName || 'не указан',
      productionSite: firstRow.siteName || 'не указан',
      scopes: Array.from(uniqueScopes),
      measurementTypes: Array.from(uniqueMeasurements),
      verifications: verificationRows.map((v) => ({
        id: v.id,
        date: v.date,
        validUntil: v.validUntil,
        result: v.result,
        protocolNumber: v.protocolNumber,
        comment: v.comment,
        documentUrl: v.documentUrl,
        metrologyControleType: v.controlTypeName || '—',
        verificationOrganization: v.orgName || '—',
      })),
    };
  }

  async createDevice(input: CreateDeviceInput, userId: string) {
    console.log(input);
    const deviceData = {
      name: input.name.trim().toLowerCase(),
      model: input.model.trim().toLowerCase(),
      serialNumber: input.serialNumber.trim().toLowerCase(),
      releaseDate: input.releaseDate,
      csmCode: input.csmCode?.trim().toLowerCase() ?? null,
      grsiNumber: input.grsiNumber?.trim().toLowerCase() ?? null,
      measurementRange: input.measurementRange?.trim().toLowerCase() ?? null,
      accuracy: input.accuracy?.trim().toLowerCase() ?? null,
      inventoryNumber: input.inventoryNumber?.trim().toLowerCase() ?? null,
      receiptDate: input.receiptDate,
      manufacturer: input.manufacturer?.trim().toLowerCase() ?? null,
      verificationInterval: input.verificationInterval,
      archived: input.archived,
      nomenclature: input.nomenclature?.trim().toLowerCase() ?? null,
      comment: input.comment?.trim().toLowerCase() ?? null,
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

      // 1. Привязка сфер
      if (input.scopes && input.scopes.length > 0) {
        const scopesData = input.scopes.map((sId) => ({
          deviceId: newDevice.id,
          scopeId: sId,
        }));
        await tx.insert(scopesToDevices).values(scopesData);
      }

      // 2. Привязка эталонов
      if (input.primaryStandarts && input.primaryStandarts.length > 0) {
        const primaryStandartsData = input.primaryStandarts.map((psId) => ({
          deviceId: newDevice.id,
          primaryStandartId: psId,
        }));
        await tx.insert(primaryStandartsToDevices).values(primaryStandartsData);
      }

      // 3. Привязка видов измерений
      if (input.measurementTypes && input.measurementTypes.length > 0) {
        const measurementTypesData = input.measurementTypes.map((mtId) => ({
          deviceId: newDevice.id,
          measurementTypeId: mtId,
        }));
        await tx.insert(measurementTypesToDevices).values(measurementTypesData);
      }

      //  if (input.verifications && input.verifications.length > 0) {
      //   const verificationsToInsert = [];

      //   // Перебираем пришедшие документы последовательно
      //   for (const v of input.verifications) {
      //     let finalOrgId = v.verificationOrganizationId ?? null;

      //     // 🔥 ЕСЛИ UUID ПУСТОЙ, НО ЕСТЬ ТЕКСТ НОВОЙ ОРГАНИЗАЦИИ (Импорт из Аршина / Ручной ввод)
      //     if (!finalOrgId && v.newOrganizationName && v.newOrganizationName.trim() !== '') {
      //       const cleanOrgName = v.newOrganizationName.trim();
      //       const searchOrgName = cleanOrgName.toLowerCase();

      //       // 1. Проверяем на бэкенде, вдруг такую организацию уже создал другой метролог (защита от дублей)
      //       const [existingOrg] = await tx
      //         .select({ id: verificationOrganizations.id })
      //         .from(verificationOrganizations)
      //         .where(sql`LOWER(${verificationOrganizations.name}) = ${searchOrgName}`)
      //         .limit(1);

      //       if (existingOrg) {
      //         finalOrgId = existingOrg.id; // Нашли в базе — привязываем к ней
      //       } else {
      //         // 2. Не нашли — честно заносим новый ЦСМ в глобальный справочник
      //         const [newOrg] = await tx
      //           .insert(verificationOrganizations)
      //           .values({ name: cleanOrgName }) // Пишем красивое имя с правильным регистром
      //           .returning({ id: verificationOrganizations.id });

      //         if (!newOrg) {
      //           throw new Error(`Не удалось автоматически создать организацию: "${cleanOrgName}"`);
      //         }
      //         finalOrgId = newOrg.id; // Запоминаем сгенерированный базой UUID
      //       }
      //     }

      //     // Формируем DTO документа для вставки в базу данных
      //     verificationsToInsert.push({
      //       deviceId: newDevice.id, // ID только что созданной карточки прибора
      //       batchId: v.batchId ?? null,
      //       protocolNumber: v.protocolNumber ?? null,
      //       result: v.result ?? 'годен',
      //       documentUrl: v.documentUrl ?? null,
      //       comment: v.comment ?? null,
      //       date: v.date,
      //       validUntil: v.validUntil ?? null,
      //       metrologyControleTypeId: v.metrologyControleTypeId ?? null,

      //       // 🔥 ЗАПИСЫВАЕМ СЮДА: Чистый, гарантированный UUID (старый или только что созданный)
      //       verificationOrganizationId: finalOrgId,

      //       cost: v.cost !== undefined && v.cost !== null && String(v.cost).trim() !== ''
      //         ? String(v.cost)
      //         : '0.00',
      //     });
      //   }

      // 4. Добавление переданных верификаций
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

      await this.updateMetrologyCache(tx, newDevice.id);

      return newDevice;
    });

    // Аудит-логи выполняются уже после успешного коммита транзакции
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
    const oldDataSnapshot = await this.getFlatAuditSnapshot(id);
    if (!oldDataSnapshot) throw new Error('Device not found');

    const deviceData = {
      name: input.name.trim().toLowerCase(),
      model: input.model.trim().toLowerCase(),
      serialNumber: input.serialNumber.trim().toLowerCase(),
      releaseDate: input.releaseDate,
      csmCode: input.csmCode?.trim().toLowerCase() ?? null,
      grsiNumber: input.grsiNumber?.trim().toLowerCase() ?? null,
      measurementRange: input.measurementRange?.trim().toLowerCase() ?? null,
      accuracy: input.accuracy?.trim().toLowerCase() ?? null,
      inventoryNumber: input.inventoryNumber?.trim().toLowerCase() ?? null,
      receiptDate: input.receiptDate,
      manufacturer: input.manufacturer?.trim().toLowerCase() ?? null,
      verificationInterval: input.verificationInterval,
      archived: input.archived,
      nomenclature: input.nomenclature?.trim().toLowerCase() ?? null,
      comment: input.comment?.trim().toLowerCase() ?? null,
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

      // 1. Синхронизация сфер
      await tx.delete(scopesToDevices).where(eq(scopesToDevices.deviceId, id));
      if (input.scopes && input.scopes.length > 0) {
        const valuesToInsert = input.scopes.map((sId) => ({
          deviceId: id,
          scopeId: sId,
        }));
        await tx.insert(scopesToDevices).values(valuesToInsert);
      }

      // 2. Синхронизация эталонов
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

      // 3. Синхронизация видов измерений
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

      // 4. Синхронизация верификаций (удаление лишних)
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

      // 5. Синхронизация верификаций (добавление / обновление)
      if (input.verifications && input.verifications.length > 0) {
        for (const v of input.verifications as any[]) {
          const payload = {
            date: v.date ? new Date(v.date) : new Date(),
            validUntil: v.validUntil ? new Date(v.validUntil) : null,
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
            await tx
              .update(verifications)
              .set(payload)
              .where(eq(verifications.id, v.id));
          } else {
            await tx.insert(verifications).values(payload);
          }
        }
      }

      await this.updateMetrologyCache(tx, id);

      return updateDevice;
    });

    const newDataSnapshot = await this.getFlatAuditSnapshot(id);

    if (this.auditLogService && oldDataSnapshot && newDataSnapshot) {
      await this.auditLogService.logAction({
        deviceId: id,
        action: 'update',
        oldData: oldDataSnapshot,
        newData: newDataSnapshot,
        userId,
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

    // 2. Находим партию, чтобы знать плановую дату и привязанную организацию
    const [batch] = await this.db
      .select()
      .from(verificationBatches)
      .where(eq(verificationBatches.id, batchId))
      .limit(1);

    if (!batch) {
      throw new Error('Партия не найдена в системе');
    }

    // Формируем временной коридор для запроса к Аршину (+2 месяца от даты плана)
    const datePart = batch.plannedDate.toISOString().split('T')[0]!;
    const futureDate = new Date(batch.plannedDate.getTime());
    futureDate.setMonth(futureDate.getMonth() + 2);
    const datePlusTwoMonths = futureDate.toISOString().split('T')[0]!;

    const arshinService = new ArshinService();

    // Вызываем обновленный метод (он теперь возвращает массив ArshinBufferInsertData[])
    const arshinRecords = await arshinService.fetchLatestVerificationFromArshin(
      device.grsiNumber,
      device.serialNumber,
      datePart,
      datePlusTwoMonths
    );

    if (!arshinRecords || arshinRecords.length === 0) {
      throw new Error(
        `Сведения о поверке во ФГИС Аршин не найдены (Зав. №: ${device.serialNumber}, ГРСИ: ${device.grsiNumber}). Возможно, поверитель еще не опубликовал данные.`
      );
    }

    // 3. Вытаскиваем организацию, которая была закреплена за партией
    let batchOrgName = '';
    if (batch.verificationOrganizationId) {
      const [batchOrg] = await this.db
        .select()
        .from(verificationOrganizations)
        .where(
          eq(verificationOrganizations.id, batch.verificationOrganizationId)
        )
        .limit(1);

      if (batchOrg) {
        // Приводим к нижнему регистру и очищаем пробелы для точного сравнения
        batchOrgName = batchOrg.name.toLowerCase().trim();
      }
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

    // 4. Формируем массив для вставки в буферную таблицу с жесткой логикой рекомендации
    const bufferEntries = arshinRecords.map((record) => {
      const recordOrgClean = record.orgTitle.toLowerCase().trim();

      // Запись рекомендована, только если в партии задан ЦСМ и строки частично или полностью совпадают
      const isRecommended =
        batchOrgName !== '' &&
        (recordOrgClean.includes(batchOrgName) ||
          batchOrgName.includes(recordOrgClean));

      const parsedDate = parseArshinDate(record.verificationDate);
      if (!parsedDate) {
        throw new Error(
          'Не удалось распарсить обязательную дату поверки из ФГИС Аршин'
        );
      }

      return {
        deviceId: deviceId,
        batchId: batchId,
        vriId: record.vriId,
        orgTitle: record.orgTitle,
        mitNumber: record.mitNumber,
        verificationDate: parsedDate,
        validDate: parseArshinDate(record.validDate) ?? undefined,
        docNum: record.docNum,
        applicability: record.applicability,
        isRecommended: isRecommended,
      };
    });

    await this.db
      .delete(arshinVerificationBuffer)
      .where(
        and(
          eq(arshinVerificationBuffer.deviceId, deviceId),
          eq(arshinVerificationBuffer.batchId, batchId)
        )
      );

    // 6. Пакетно вставляем все найденные варианты в буфер
    // Используем onConflictDoNothing на случай, если этот vriId уже занят в буфере другой партии
    await this.db
      .insert(arshinVerificationBuffer)
      .values(bufferEntries)
      .onConflictDoNothing();

    // 7. Меняем статус прибора на "проверяется/в буфере" или обновляем devicesToBatches
    // Рекомендую статус 'returned' ставить только после финального выбора записи метрологом,
    // а сейчас поставить статус, говорящий о том, что данные в буфере (например, 'buffer_review' или оставить текущий)
    // await this.db
    //   .update(devicesToBatches)
    //   .set({ deviceStatus: 'returned' }) // или 'ready_for_review', если завели такой статус
    //   .where(
    //     and(
    //       eq(devicesToBatches.deviceId, deviceId),
    //       eq(devicesToBatches.batchId, batchId)
    //     )
    //   );

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

  // async importDevicesFromExcel(
  //   items: ImportDeviceItem[],
  //   userId: string
  // ): Promise<number> {
  //   let importedCount = 0;

  //   const parseMultipleNames = (
  //     rawString: string | null | undefined
  //   ): string[] => {
  //     if (!rawString) return [];

  //     return (
  //       rawString
  //         // 🎯 РЕГУЛЯРКА-ВСЕЯДНАЯ:
  //         // [,;/|\n\r]+ означает деление по запятой, точке с запятой, косой черте, вертикальной черте или ЛЮБОМУ переносу строки
  //         .split(/[,;/|\n\r]+/)
  //         .map((name) => name.trim())
  //         // Дополнительно отсекаем пустые элементы и пробельные строки
  //         .filter((name) => name.length > 0)
  //     );
  //   };

  //   await this.db.transaction(async (tx) => {
  //     const cityCache = new Map<string, string>(); // name -> id
  //     const companyCache = new Map<string, string>(); // name -> id
  //     const siteCache = new Map<string, string>(); // "companyId_cityId_name" -> id
  //     const statusCache = new Map<string, string>(); // name -> id
  //     const typeCache = new Map<string, string>(); // name -> id
  //     const scopeCache = new Map<string, string>(); // name -> id
  //     const measTypeCache = new Map<string, string>(); // name -> id
  //     const standardCache = new Map<string, string>(); // name -> id

  //     for (const item of items) {
  //       const normCity = item.cityName.trim();
  //       const normCompany = item.companyName.trim();
  //       const normSite = item.productionSiteName.trim();
  //       const normStatus = item.statusName.trim();
  //       const normType = item.equipmentTypeName?.trim();

  //       // 1. Разруливаем Город (City)
  //       let cityId = cityCache.get(normCity.toLowerCase());
  //       if (!cityId) {
  //         const [existing] = await tx
  //           .select()
  //           .from(cities)
  //           .where(eq(sql`lower(${cities.name})`, normCity.toLowerCase()))
  //           .limit(1);
  //         if (existing) {
  //           cityId = existing.id;
  //         } else {
  //           const insertedCities = await tx
  //             .insert(cities)
  //             .values({ name: normCity.toLowerCase() })
  //             .returning();
  //           // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
  //           const inserted = insertedCities[0];
  //           if (!inserted)
  //             throw new Error(`Не удалось создать город: ${normCity}`);
  //           cityId = inserted.id;
  //         }
  //         cityCache.set(normCity.toLowerCase(), cityId);
  //       }

  //       // 2. Разруливаем Компания (Company)
  //       let companyId = companyCache.get(normCompany.toLowerCase());
  //       if (!companyId) {
  //         const [existing] = await tx
  //           .select()
  //           .from(companies)
  //           .where(eq(sql`lower(${companies.name})`, normCompany.toLowerCase()))
  //           .limit(1);
  //         if (existing) {
  //           companyId = existing.id;
  //         } else {
  //           const insertedCompanies = await tx
  //             .insert(companies)
  //             .values({ name: normCompany.toLowerCase() })
  //             .returning();
  //           // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
  //           const inserted = insertedCompanies[0];
  //           if (!inserted)
  //             throw new Error(`Не удалось создать компанию: ${normCompany}`);
  //           companyId = inserted.id;
  //         }
  //         companyCache.set(normCompany.toLowerCase(), companyId);
  //       }

  //       // 3. Разруливаем Площадку (Production Site)
  //       const siteKey = `${companyId}_${cityId}_${normSite.toLowerCase()}`;
  //       let siteId = siteCache.get(siteKey);
  //       if (!siteId) {
  //         const [existing] = await tx
  //           .select()
  //           .from(productionSites)
  //           .where(
  //             and(
  //               eq(productionSites.companyId, companyId),
  //               eq(productionSites.cityId, cityId),
  //               eq(sql`lower(${productionSites.name})`, normSite.toLowerCase())
  //             )
  //           )
  //           .limit(1);

  //         if (existing) {
  //           siteId = existing.id;
  //         } else {
  //           const insertedSites = await tx
  //             .insert(productionSites)
  //             .values({
  //               name: normSite.toLowerCase(),
  //               companyId,
  //               cityId,
  //             })
  //             .returning();
  //           // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
  //           const inserted = insertedSites[0];
  //           if (!inserted)
  //             throw new Error(`Не удалось создать площадку: ${normSite}`);
  //           siteId = inserted.id;
  //         }
  //         siteCache.set(siteKey, siteId);
  //       }

  //       // 4. Разруливаем Статус (Status)
  //       let statusId = statusCache.get(normStatus.toLowerCase());
  //       if (!statusId) {
  //         const [existing] = await tx
  //           .select()
  //           .from(statuses)
  //           .where(eq(sql`lower(${statuses.name})`, normStatus.toLowerCase()))
  //           .limit(1);
  //         if (existing) {
  //           statusId = existing.id;
  //         } else {
  //           const insertedStatuses = await tx
  //             .insert(statuses)
  //             .values({ name: normStatus.toLowerCase() })
  //             .returning();
  //           // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
  //           const inserted = insertedStatuses[0];
  //           if (!inserted)
  //             throw new Error(`Не удалось создать статус: ${normStatus}`);
  //           statusId = inserted.id;
  //         }
  //         statusCache.set(normStatus.toLowerCase(), statusId);
  //       }

  //       // 5. Разруливаем Тип оборудования (Equipment Type) - опционально
  //       let equipmentTypeId: string | null = null;
  //       if (normType) {
  //         equipmentTypeId = typeCache.get(normType.toLowerCase()) || null;
  //         if (!equipmentTypeId) {
  //           const [existing] = await tx
  //             .select()
  //             .from(equipmentTypes)
  //             .where(
  //               eq(sql`lower(${equipmentTypes.name})`, normType.toLowerCase())
  //             )
  //             .limit(1);
  //           if (existing) {
  //             equipmentTypeId = existing.id;
  //           } else {
  //             const insertedTypes = await tx
  //               .insert(equipmentTypes)
  //               .values({ name: normType.toLowerCase() })
  //               .returning();
  //             // 🎯 ИСПРАВЛЕНИЕ: Забираем ПЕРВЫЙ элемент из массива возврата
  //             const inserted = insertedTypes[0];
  //             if (!inserted)
  //               throw new Error(
  //                 `Не удалось создать тип оборудования: ${normType}`
  //               );
  //             equipmentTypeId = inserted.id;
  //           }
  //           if (equipmentTypeId)
  //             typeCache.set(normType.toLowerCase(), equipmentTypeId);
  //         }
  //       }

  //       // 6. Проверяем дубликат прибора по серийному номеру и модели, чтобы не плодить копии
  //       const [duplicate] = await tx
  //         .select()
  //         .from(devices)
  //         .where(
  //           and(
  //             eq(
  //               sql`lower(${devices.serialNumber})`,
  //               item.serialNumber.trim().toLowerCase()
  //             ),
  //             eq(sql`lower(${devices.model})`, item.model.trim().toLowerCase())
  //           )
  //         )
  //         .limit(1);

  //       if (duplicate) {
  //         // Если такой прибор уже есть — просто пропускаем его, либо обновляем (мы пропустим)
  //         continue;
  //       }

  //       // 7. Безопасный парсинг интервала поверки (МПИ)
  //       const parsedInterval = item.verificationInterval
  //         ? parseInt(item.verificationInterval, 10)
  //         : null;

  //       // 8. Вставляем прибор в базу
  //       const [newDevice] = await tx
  //         .insert(devices)
  //         .values({
  //           name: item.name.trim(),
  //           model: item.model.trim(),
  //           serialNumber: item.serialNumber.trim(),
  //           grsiNumber: item.grsiNumber?.trim() || null,
  //           inventoryNumber: item.inventoryNumber?.trim() || null,
  //           manufacturer: item.manufacturer?.trim() || null,
  //           verificationInterval: isNaN(parsedInterval as number)
  //             ? null
  //             : parsedInterval,
  //           nomenclature: item.nomenclature?.trim() || null,
  //           comment: item.comment?.trim() || null,
  //           statusId: statusId!,
  //           productionSiteId: siteId!,
  //           equipmentTypeId: equipmentTypeId,
  //           archived: false,
  //           measurementRange: item.measurementRange?.trim() || null,
  //           accuracy: item.accuracy?.trim() || null,
  //         })
  //         .returning();

  //       if (!newDevice)
  //         throw new Error(`Не удалось создать прибор: ${item.name}`);
  //       const deviceId = newDevice.id;

  //       // 🎯 2. РАЗРУЛИВАЕМ СФЕРЫ ГОСРЕГУЛИРОВАНИЯ (Many-to-Many)
  //       const targetScopes = parseMultipleNames(item.scopesNames);
  //       for (const scopeName of targetScopes) {
  //         let scopeId = scopeCache.get(scopeName.toLowerCase());
  //         if (!scopeId) {
  //           const [existing] = await tx
  //             .select()
  //             .from(scopes)
  //             .where(eq(sql`lower(${scopes.name})`, scopeName.toLowerCase()))
  //             .limit(1);
  //           if (existing) {
  //             scopeId = existing.id;
  //           } else {
  //             const insertedScopes = await tx
  //               .insert(scopes)
  //               .values({ name: scopeName.toLowerCase() })
  //               .returning();
  //             // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
  //             const inserted = insertedScopes[0];
  //             if (!inserted)
  //               throw new Error(
  //                 `Не удалось создать сферу регулирования: ${scopeName}`
  //               );
  //             scopeId = inserted.id;
  //           }
  //           scopeCache.set(scopeName.toLowerCase(), scopeId);
  //         }
  //         // Записываем связь в промежуточную таблицу
  //         await tx
  //           .insert(scopesToDevices)
  //           .values({ deviceId, scopeId })
  //           .onConflictDoNothing();
  //       }

  //       // 🎯 3. РАЗРУЛИВАЕМ ВИДЫ ИЗМЕРЕНИЙ (Many-to-Many)
  //       const targetMeasTypes = parseMultipleNames(item.measurementTypesNames);
  //       for (const mTypeName of targetMeasTypes) {
  //         let mTypeId = measTypeCache.get(mTypeName.toLowerCase());
  //         if (!mTypeId) {
  //           const [existing] = await tx
  //             .select()
  //             .from(measurementTypes)
  //             .where(
  //               eq(
  //                 sql`lower(${measurementTypes.name})`,
  //                 mTypeName.toLowerCase()
  //               )
  //             )
  //             .limit(1);
  //           if (existing) {
  //             mTypeId = existing.id;
  //           } else {
  //             const insertedTypes = await tx
  //               .insert(measurementTypes)
  //               .values({ name: mTypeName.toLowerCase() })
  //               .returning();
  //             // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
  //             const inserted = insertedTypes[0];
  //             if (!inserted)
  //               throw new Error(
  //                 `Не удалось создать вид измерений: ${mTypeName}`
  //               );
  //             mTypeId = inserted.id;
  //           }
  //           measTypeCache.set(mTypeName.toLowerCase(), mTypeId);
  //         }
  //         // Записываем связь в промежуточную таблицу
  //         await tx
  //           .insert(measurementTypesToDevices)
  //           .values({ deviceId, measurementTypeId: mTypeId })
  //           .onConflictDoNothing();
  //       }

  //       // 🎯 4. РАЗРУЛИВАЕМ ПЕРВИЧНЫЕ ЭТАЛОНЫ (Many-to-Many)
  //       const targetStandards = parseMultipleNames(item.primaryStandardsNames);
  //       for (const stdName of targetStandards) {
  //         let stdId = standardCache.get(stdName.toLowerCase());
  //         if (!stdId) {
  //           const [existing] = await tx
  //             .select()
  //             .from(primaryStandarts)
  //             .where(
  //               eq(sql`lower(${primaryStandarts.name})`, stdName.toLowerCase())
  //             )
  //             .limit(1);
  //           if (existing) {
  //             stdId = existing.id;
  //           } else {
  //             const insertedStandards = await tx
  //               .insert(primaryStandarts)
  //               .values({ name: stdName.toLowerCase() })
  //               .returning();
  //             // 🎯 ИСПРАВЛЕНИЕ: Безопасное извлечение объекта из массива
  //             const inserted = insertedStandards[0];
  //             if (!inserted)
  //               throw new Error(
  //                 `Не удалось создать первичный эталон: ${stdName}`
  //               );
  //             stdId = inserted.id;
  //           }
  //           standardCache.set(stdName.toLowerCase(), stdId);
  //         }
  //         // Записываем связь в промежуточную таблицу
  //         await tx
  //           .insert(primaryStandartsToDevices)
  //           .values({ deviceId, primaryStandartId: stdId })
  //           .onConflictDoNothing();
  //       }

  //       importedCount++;
  //     }
  //   });

  //   // Запись общего действия в лог аудита (опционально, можно расширить лог на каждый прибор)
  //   // if (this.auditLogService && importedCount > 0) {
  //   //   await this.auditLogService.logAction({
  //   //     action: 'create',
  //   //     description: `Выполнен пакетный импорт приборов из Excel. Успешно загружено: ${importedCount} шт.`,
  //   //     userId,
  //   //   });
  //   // }

  //   return importedCount;
  // }

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

  // async getDevicesBarcodeData(input: PrintBarcodesInput) {
  //   // const { deviceIds, controlType, historyLinkIds } = input;
  //   const { deviceIds, historyLinkIds } = input;
  //   const results: any[] = [];

  //   // ВЕТКА А: ПЕЧАТЬ ИЗ АРХИВА (По явным ID связей из devices_to_batches)
  //   if (historyLinkIds && historyLinkIds.length > 0) {
  //     const cleanLinkIds = historyLinkIds.map((id) => id.toLowerCase().trim());

  //     const archiveRecords = await this.db
  //       .select({
  //         id: devicesToBatches.id, // ID самой связи, чтобы Apollo закэшировал строку
  //         name: devices.name,
  //         model: devices.model,
  //         serialNumber: devices.serialNumber,
  //         statusName: sql<string>`CASE WHEN ${verifications.result} = 'годен' THEN 'исправен' ELSE 'неисправен' END`,
  //         // controlType: sql<string>`CASE WHEN ${verificationBatches.type} = 'inspection' THEN 'осмотр' ELSE 'поверка' END`,
  //         controlType: metrologyControleTypes.name,
  //         validUntil: verifications.validUntil,
  //       })
  //       .from(devicesToBatches)
  //       .leftJoin(devices, eq(devicesToBatches.deviceId, devices.id))
  //       .leftJoin(statuses, eq(devices.statusId, statuses.id))
  //       .leftJoin(
  //         verificationBatches,
  //         eq(devicesToBatches.batchId, verificationBatches.id)
  //       )
  //       // Привязываемся к verifications строго по совпадению deviceId и batchId!
  //       .leftJoin(
  //         verifications,
  //         and(
  //           eq(verifications.deviceId, devicesToBatches.deviceId),
  //           eq(verifications.batchId, devicesToBatches.batchId)
  //         )
  //       )
  //       .leftJoin(
  //         metrologyControleTypes,
  //         eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
  //       )

  //       .where(inArray(devicesToBatches.id, cleanLinkIds));

  //     results.push(...archiveRecords);
  //   }

  //   // ВЕТКА Б: УМНАЯ ПЕЧАТЬ С ГЛАВНОЙ СТРАНИЦЫ (По чистым ID приборов)
  //   if (deviceIds && deviceIds.length > 0) {
  //     const cleanDeviceIds = deviceIds.map((id) => id.toLowerCase().trim());

  //     for (const deviceId of cleanDeviceIds) {
  //       let typeConditionSql = '';

  //       // 🎯 ЛОГИКА АВТОМАТИКИ НА СЕРВЕРЕ:
  //       // Если фронтенд НЕ передал controlType (печать с главной страницы)
  //       // if (!controlType) {
  //       // Делаем экспресс-проверку прибора в БД: относится ли он к сфере госрегулирования (СИ)?
  //       // Например, проверяем имя типа оборудования. Настройте это условие под вашу БД.
  //       const [deviceCheck] = await this.db
  //         .select({
  //           typeName: equipmentTypes.name,
  //           grsiNumber: devices.grsiNumber,
  //         })
  //         .from(devices)
  //         .leftJoin(
  //           equipmentTypes,
  //           eq(devices.equipmentTypeId, equipmentTypes.id)
  //         )
  //         .where(eq(devices.id, deviceId));

  //       const deviceScopesData = await this.db
  //         .select({ scopeName: scopes.name })
  //         .from(scopesToDevices)
  //         .leftJoin(scopes, eq(scopesToDevices.scopeId, scopes.id))
  //         .where(eq(scopesToDevices.deviceId, deviceId));

  //       const eqTypeName = deviceCheck?.typeName?.toLowerCase().trim() ?? '';
  //       const deviceScopes = deviceScopesData.map(
  //         (s) => s.scopeName?.toLowerCase().trim() ?? ''
  //       );

  //       const hasGrsi =
  //         !!deviceCheck?.grsiNumber && deviceCheck.grsiNumber.trim() !== '';

  //       const isNotGr =
  //         deviceScopes.includes('не гр') ||
  //         deviceScopes.includes(
  //           'вне сферы государственного регулирования (не гр)'
  //         );

  //       let targetControlName = 'осмотр';

  //       if (
  //         eqTypeName === 'индикатор' ||
  //         eqTypeName === 'вспомогательное оборудование (во)'
  //       ) {
  //         // Индикаторы и ВО — это всегда осмотр без исключений
  //         targetControlName = 'осмотр';
  //       } else if (eqTypeName === 'средство измерений (си)') {
  //         // СИ: Если есть ГРСИ И при этом (сферы пустые ИЛИ сфера точно НЕ "не ГР") -> ПОВЕРКА.
  //         // Во всех остальных случаях (есть "не ГР" ИЛИ нет ГРСИ) -> ОСМОТР.
  //         if (hasGrsi && !isNotGr) {
  //           targetControlName = 'поверка';
  //         } else {
  //           targetControlName = 'осмотр';
  //         }
  //       } else if (eqTypeName === 'средство контроля (ск)') {
  //         console.log('2', eqTypeName);
  //         // СК: Если сфера "не ГР" -> ОСМОТР.
  //         if (isNotGr) {
  //           console.log('3', isNotGr);
  //           targetControlName = 'осмотр';
  //         } else {
  //           console.log('4', hasGrsi);
  //           // Если другая сфера или пусто: смотрим на ГРСИ. Есть ГРСИ -> ПОВЕРКА, нет ГРСИ -> КАЛИБРОВКА.
  //           targetControlName = hasGrsi ? 'поверка' : 'калибровка';
  //         }
  //       } else if (eqTypeName === 'испытательное оборудование (ио)') {
  //         // ИО: Если сфера "не ГР" -> ОСМОТР. Если нет "не ГР" или пусто -> АТТЕСТАЦИЯ.
  //         targetControlName = isNotGr ? 'осмотр' : 'аттестация';
  //       }

  //       // Формируем SQL-условие для подзапроса MAX(date)
  //       typeConditionSql = `AND LOWER(mct.name) = '${targetControlName}'`;
  //       // } else {
  //       //   // Если фронтенд жестко передал тип (из конкретных журналов) — используем его напрямую
  //       //   typeConditionSql = `AND LOWER(mct.name) = '${controlType
  //       //     .toLowerCase()
  //       //     .trim()}'`;
  //       // }

  //       // Вытаскиваем данные прибора с учетом вычисленного условия typeCondition
  //       const [deviceRecord] = await this.db
  //         .select({
  //           id: devices.id,
  //           name: devices.name,
  //           model: devices.model,
  //           serialNumber: devices.serialNumber,
  //           statusName: sql<string>`CASE WHEN ${verifications.result} = 'годен' THEN 'исправен' ELSE 'неисправен' END`,
  //           controlType: metrologyControleTypes.name,
  //           validUntil: verifications.validUntil,
  //         })
  //         .from(devices)
  //         .leftJoin(statuses, eq(devices.statusId, statuses.id))
  //         .leftJoin(
  //           verifications,
  //           and(
  //             eq(verifications.deviceId, devices.id),
  //             // eq(
  //             //   verifications.date,
  //             //   sql`(
  //             //     SELECT MAX(v.date)
  //             //     FROM verifications v
  //             //     LEFT JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
  //             //     WHERE v.device_id = ${devices.id} ${sql.raw(typeConditionSql)}
  //             //   )`
  //             // )
  //             eq(
  //               verifications.id,
  //               sql`(
  //                 SELECT v.id
  //                 FROM verifications v
  //                 LEFT JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
  //                 WHERE v.device_id = ${devices.id} ${sql.raw(typeConditionSql)}
  //                 ORDER BY v.date DESC, v.id DESC
  //                 LIMIT 1
  //               )`
  //             )
  //           )
  //         )
  //         .leftJoin(
  //           metrologyControleTypes,
  //           eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
  //         )
  //         .where(eq(devices.id, deviceId));

  //       if (deviceRecord) {
  //         results.push(deviceRecord);
  //       }
  //     }
  //   }

  //   return results;
  // }

  async getDevicesBarcodeData(input: PrintBarcodesInput) {
    const { deviceIds, controlType, historyLinkIds } = input;
    const results: any[] = [];

    // =========================================================================
    // ВЕТКА А: ПЕЧАТЬ ИЗ АРХИВА (По явным ID связей из devices_to_batches)
    // =========================================================================
    if (historyLinkIds && historyLinkIds.length > 0) {
      const cleanLinkIds = historyLinkIds.map((id) => id.toLowerCase().trim());

      const archiveRecords = await this.db
        .select({
          id: devicesToBatches.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
          statusName: sql<string>`CASE WHEN ${verifications.result} = 'годен' THEN 'исправен' ELSE 'неисправен' END`,
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

    // =========================================================================
    // ВЕТКА Б: МГНОВЕННАЯ МАССОВАЯ ПЕЧАТЬ С ГЛАВНЫХ СТРАНИЦ ЖУРНАЛОВ
    // =========================================================================
    if (deviceIds && deviceIds.length > 0) {
      const cleanDeviceIds = deviceIds.map((id) => id.toLowerCase().trim());

      // 1. Сначала выгребаем характеристики нужных приборов за ОДИН быстрый запрос (никаких циклов!)
      const targetDevices = await this.db
        .select({
          id: devices.id,
          name: devices.name,
          model: devices.model,
          serialNumber: devices.serialNumber,
          cachedControl: devices.cachedControl, // Читаем уже готовый расчет автомата!
        })
        .from(devices)
        .where(inArray(devices.id, cleanDeviceIds));

      // 2. Пробегаем по приборам и вытаскиваем для каждого точечный актуальный документ
      for (const dev of targetDevices) {
        // Вычисляем, какой тип документа искать в истории для вывода на бирку
        let targetControlName = 'осмотр';

        if (controlType?.toLowerCase().trim() === 'inspection') {
          // Если печатаем из Журнала осмотров — нам на бирке нужен строго Осмотр
          targetControlName = 'осмотр';
        } else {
          // Если из Журнала поверок — берем то, что для прибора рассчитал автомат (поверка/калибровка/аттестация)
          targetControlName = dev.cachedControl || 'поверка';
        }

        // Вытаскиваем прибор и связываем с ЕДИНСТВЕННЫМ последним документом нужного типа
        const [deviceRecord] = await this.db
          .select({
            id: devices.id,
            name: devices.name,
            model: devices.model,
            serialNumber: devices.serialNumber,
            statusName: sql<string>`CASE WHEN ${verifications.result} = 'годен' THEN 'исправен' ELSE 'неисправен' END`,
            controlType: metrologyControleTypes.name,
            validUntil: verifications.validUntil,
          })
          .from(devices)
          .leftJoin(statuses, eq(devices.statusId, statuses.id))
          .leftJoin(
            verifications,
            and(
              eq(verifications.deviceId, devices.id),
              // Вытаскиваем строго последний ID документа заданного типа контроля (Поверка или Осмотр)
              eq(
                verifications.id,
                sql`(
                  SELECT v.id
                  FROM verifications v
                  LEFT JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
                  WHERE v.device_id = ${
                    devices.id
                  } AND LOWER(mct.name) = ${targetControlName
                  .toLowerCase()
                  .trim()}
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
          .where(eq(devices.id, dev.id));

        if (deviceRecord) {
          // Если прибор абсолютно новый и документов в истории еще нет, leftJoin вернет пустые поля верификации.
          // Подстрахуем и запишем вычисленный тип контроля, чтобы бирка не была пустой.
          results.push({
            ...deviceRecord,
            controlType: deviceRecord.controlType || targetControlName,
          });
        }
      }
    }

    return results;
  }

  async updateMetrologyCache(db: any, deviceId: string): Promise<void> {
    // 1. Забираем характеристики прибора за один проход
    const rows = await db
      .select({
        grsiNumber: devices.grsiNumber,
        releaseDate: devices.releaseDate,
        receiptDate: devices.receiptDate,
        verificationInterval: devices.verificationInterval,
        eqName: equipmentTypes.name,
        scopeName: scopes.name,
      })
      .from(devices)
      .leftJoin(equipmentTypes, eq(devices.equipmentTypeId, equipmentTypes.id))
      .leftJoin(scopesToDevices, eq(scopesToDevices.deviceId, devices.id))
      .leftJoin(scopes, eq(scopesToDevices.scopeId, scopes.id))
      .where(eq(devices.id, deviceId));

    if (!rows || rows.length === 0) return;

    const firstRow = rows[0];
    const eqTypeName = firstRow.eqName
      ? firstRow.eqName.toLowerCase().trim()
      : '';
    const hasGrsi = !!firstRow.grsiNumber && firstRow.grsiNumber.trim() !== '';

    // Собираем сферы
    const scopeNames = rows
      .map((r: any) => r.scopeName?.toLowerCase().trim() ?? '')
      .filter(Boolean);

    const isNotGr =
      scopeNames.includes('не гр') ||
      scopeNames.includes('вне сферы государственного регулирования (не гр)');

    const isSiOrSk =
      eqTypeName === 'средство измерений (си)' ||
      eqTypeName === 'средство контроля (ск)';

    // 2. Вычисляем строгое название целевого контроля (Ваша логика)
    let targetControlName = 'осмотр';
    // if (
    //   eqTypeName === 'индикатор' ||
    //   eqTypeName === 'вспомогательное оборудование (во)'
    // ) {
    //   targetControlName = 'осмотр';
    // } else if (eqTypeName === 'средство измерений (си)') {
    //   targetControlName = hasGrsi && !isNotGr ? 'поверка' : 'осмотр';
    // } else if (eqTypeName === 'средство контроля (ск)') {
    //   targetControlName = isNotGr
    //     ? 'осмотр'
    //     : hasGrsi
    //     ? 'поверка'
    //     : 'калибровка';
    // } else if (eqTypeName === 'испытательное оборудование (ио)') {
    //   targetControlName = isNotGr ? 'осмотр' : 'аттестация';
    // }

    if (isSiOrSk) {
      // По словам метролога: если есть ГРСИ и сфера -> поверка. Всё остальное -> калибровка.
      if (hasGrsi && !isNotGr) {
        targetControlName = 'поверка';
      } else {
        targetControlName = 'калибровка';
      }
    } else if (eqTypeName === 'испытательное оборудование (ио)') {
      targetControlName = 'аттестация';
    } else {
      // Только индикаторы и ВО изначально считаются «простыми» и сразу планируются на осмотр
      targetControlName = 'осмотр';
    }

    // 3. Ищем самый свежий документ этого контроля в истории
    const [latestTargetDoc] = await db
      .select({ validUntil: verifications.validUntil })
      .from(verifications)
      .leftJoin(
        metrologyControleTypes,
        eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
      )
      .where(
        and(
          eq(verifications.deviceId, deviceId),
          eq(metrologyControleTypes.name, targetControlName)
        )
      )
      .orderBy(sql`${verifications.date} DESC NULLS LAST`)
      .limit(1);

    // Б) Ищем последний документ ИМЕННО ОСМОТРА
    const [latestInspectionDoc] = await db
      .select({ validUntil: verifications.validUntil })
      .from(verifications)
      .leftJoin(
        metrologyControleTypes,
        eq(verifications.metrologyControleTypeId, metrologyControleTypes.id)
      )
      .where(
        and(
          eq(verifications.deviceId, deviceId),
          eq(metrologyControleTypes.name, 'осмотр')
        )
      )
      .orderBy(sql`${verifications.date} DESC NULLS LAST`)
      .limit(1);

    // 4. ИНТЕГРАЦИЯ ВАШЕГО МЕТОДА РАСЧЕТА СЛЕДУЮЩЕЙ ДАТЫ
    let nextVerificationDateStr: string | null = null;

    if (latestTargetDoc?.validUntil) {
      nextVerificationDateStr = new Date(latestTargetDoc.validUntil)
        .toISOString()
        .slice(0, 10);
    } else if (targetControlName !== 'осмотр') {
      const baseDate = firstRow.releaseDate || firstRow.receiptDate;
      if (baseDate && firstRow.verificationInterval) {
        const nextDate = new Date(baseDate);
        nextDate.setMonth(nextDate.getMonth() + firstRow.verificationInterval);
        nextVerificationDateStr = nextDate.toISOString().slice(0, 10);
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        nextVerificationDateStr = `${year}-${month}-${day}`;
      }
    } else {
      nextVerificationDateStr = null;
    }

    let nextInspectionDateStr: string | null = null;

    if (latestInspectionDoc?.validUntil) {
      nextInspectionDateStr = new Date(latestInspectionDoc.validUntil)
        .toISOString()
        .slice(0, 10);
    } else if (targetControlName === 'осмотр') {
      // 🔥 Считаем дефолтную дату ТОЛЬКО для Индикаторов и ВО!
      const baseDate = firstRow.releaseDate || firstRow.receiptDate;
      if (baseDate && firstRow.verificationInterval) {
        const nextDate = new Date(baseDate);
        nextDate.setMonth(nextDate.getMonth() + firstRow.verificationInterval);
        nextInspectionDateStr = nextDate.toISOString().slice(0, 10);
      } else {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        nextInspectionDateStr = `${year}-${month}-${day}`;
      }
    } else {
      // Для СИ, СК и ИО, которые еще ни разу не осматривались,
      // оставляем null, чтобы они не лезли в календарь осмотров раньше времени.
      nextInspectionDateStr = null;
    }

    // Записываем стейт в карточку прибора
    await db
      .update(devices)
      .set({
        cachedControl: targetControlName,
        nextVerificationDate: nextVerificationDateStr, // Теперь сюда улетит чистая строка без багов
        nextInspectionDate: nextInspectionDateStr,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));
  }

  async importDevicesFromExcel(
    items: ImportDeviceItem[],
    userId: string
  ): Promise<number> {
    if (items.length === 0) return 0;

    // Всеядная регулярка, которая сразу переводит элементы в нижний регистр
    const parseMultipleNames = (
      rawString: string | null | undefined
    ): string[] => {
      if (!rawString) return [];
      return rawString
        .split(/[,;/|\n\r]+/)
        .map((name) => name.trim().toLowerCase())
        .filter((name) => name.length > 0);
    };

    // Инициализируем кэш-карты для работы в памяти O(1)
    const cityCache = new Map<string, string>();
    const companyCache = new Map<string, string>();
    const siteCache = new Map<string, string>(); // Ключ: "companyId_cityId_siteName"
    const statusCache = new Map<string, string>();
    const typeCache = new Map<string, string>();
    const scopeCache = new Map<string, string>();
    const measTypeCache = new Map<string, string>();
    const standardCache = new Map<string, string>();

    // Быстрый Set для мгновенного отсечения дубликатов приборов в JS за наносекунды
    const existingDevicesSet = new Set<string>(); // Ключ: "serial_model"

    // =========================================================================
    // ЭТАП 1: ПРЕДЗАГРУЗКА ВСЕХ СУЩЕСТВУЮЩИХ СПРАВОЧНИКОВ ИЗ БД (Pre-loading)
    // =========================================================================
    await Promise.all([
      this.db
        .select()
        .from(cities)
        .then((res) => res.forEach((r) => cityCache.set(r.name, r.id))),
      this.db
        .select()
        .from(companies)
        .then((res) => res.forEach((r) => companyCache.set(r.name, r.id))),
      this.db
        .select()
        .from(statuses)
        .then((res) => res.forEach((r) => statusCache.set(r.name, r.id))),
      this.db
        .select()
        .from(equipmentTypes)
        .then((res) => res.forEach((r) => typeCache.set(r.name, r.id))),
      this.db
        .select()
        .from(scopes)
        .then((res) => res.forEach((r) => scopeCache.set(r.name, r.id))),
      this.db
        .select()
        .from(measurementTypes)
        .then((res) => res.forEach((r) => measTypeCache.set(r.name, r.id))),
      this.db
        .select()
        .from(primaryStandarts)
        .then((res) => res.forEach((r) => standardCache.set(r.name, r.id))),
      this.db
        .select()
        .from(productionSites)
        .then((res) =>
          res.forEach((r) =>
            siteCache.set(`${r.companyId}_${r.cityId}_${r.name}`, r.id)
          )
        ),
      // Предзагрузка дубликатов (вытягиваем только два легких текстовых поля)
      this.db
        .select({ serial: devices.serialNumber, model: devices.model })
        .from(devices)
        .then((res) =>
          res.forEach((r) => existingDevicesSet.add(`${r.serial}_${r.model}`))
        ),
    ]);

    let importedCount = 0;
    // =========================================================================
    // ЭТАП 2: АТОМАРНАЯ ТРАНЗАКЦИЯ И ЦИКЛ СБОРКИ ПАКЕТОВ (Bulk Data Processing)
    // =========================================================================
    await this.db.transaction(async (tx) => {
      const devicesToInsert: any[] = [];

      // Массивы для отложенной пакетной записи Many-to-Many связей
      const scopeRelationsToInsert: any[] = [];
      const measRelationsToInsert: any[] = [];
      const stdRelationsToInsert: any[] = [];

      for (const item of items) {
        const normCity = item.cityName.trim().toLowerCase();
        const normCompany = item.companyName.trim().toLowerCase();
        const normSite = item.productionSiteName.trim().toLowerCase();
        const normStatus = item.statusName.trim().toLowerCase();
        const normType = item.equipmentTypeName?.trim().toLowerCase();
        const normSerial = item.serialNumber.trim().toLowerCase();
        const normModel = item.model.trim().toLowerCase();

        // 1. Быстрая проверка на дубликат прибора в памяти JS (База данных отдыхает)
        if (existingDevicesSet.has(`${normSerial}_${normModel}`)) {
          continue;
        }

        // 2. Динамическое создание Города (только если его вообще не было в системе)
        let cityId = cityCache.get(normCity);
        if (!cityId) {
          const [inserted] = await tx
            .insert(cities)
            .values({ name: normCity })
            .returning();
          if (!inserted)
            throw new Error(`Не удалось создать город: ${item.cityName}`);
          cityId = inserted.id;
          cityCache.set(normCity, cityId);
        }

        // 3. Динамическое создание Компании
        let companyId = companyCache.get(normCompany);
        if (!companyId) {
          const [inserted] = await tx
            .insert(companies)
            .values({ name: normCompany })
            .returning();
          if (!inserted)
            throw new Error(`Не удалось создать компанию: ${item.companyName}`);
          companyId = inserted.id;
          companyCache.set(normCompany, companyId);
        }

        // 4. Динамическое создание Площадки (Production Site)
        const siteKey = `${companyId}_${cityId}_${normSite}`;
        let siteId = siteCache.get(siteKey);
        if (!siteId) {
          const [inserted] = await tx
            .insert(productionSites)
            .values({ name: normSite, companyId, cityId })
            .returning();
          if (!inserted)
            throw new Error(
              `Не удалось создать площадку: ${item.productionSiteName}`
            );
          siteId = inserted.id;
          siteCache.set(siteKey, siteId);
        }

        // 5. Динамическое создание Статуса
        let statusId = statusCache.get(normStatus);
        if (!statusId) {
          const [inserted] = await tx
            .insert(statuses)
            .values({ name: normStatus })
            .returning();
          if (!inserted)
            throw new Error(`Не удалось создать статус: ${item.statusName}`);
          statusId = inserted.id;
          statusCache.set(normStatus, statusId);
        }

        // 6. Динамическое создание Типа оборудования
        let equipmentTypeId: string | null = null;
        if (normType) {
          equipmentTypeId = typeCache.get(normType) || null;
          if (!equipmentTypeId) {
            const [inserted] = await tx
              .insert(equipmentTypes)
              .values({ name: normType })
              .returning();
            if (!inserted)
              throw new Error(
                `Не удалось создать тип оборудования: ${item.equipmentTypeName}`
              );
            equipmentTypeId = inserted.id;
            typeCache.set(normType, equipmentTypeId);
          }
        }

        // Паттерн Enterprise-импорта: Генерируем UUID прибора на бэкенде.
        // Это позволяет нам связать Many-to-Many таблицы с прибором ДО того, как он запишется в базу!
        const generatedDeviceId = crypto.randomUUID();
        const parsedInterval = item.verificationInterval
          ? parseInt(item.verificationInterval, 10)
          : null;

        // Накапливаем плоский объект прибора в пакетный массив
        devicesToInsert.push({
          id: generatedDeviceId,
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
        });

        // 7. Сбор пакета связей для Сфер госрегулирования
        const targetScopes = parseMultipleNames(item.scopesNames);
        for (const scopeName of targetScopes) {
          let scopeId = scopeCache.get(scopeName);
          if (!scopeId) {
            const [inserted] = await tx
              .insert(scopes)
              .values({ name: scopeName })
              .returning();
            if (!inserted)
              throw new Error(`Не удалось создать сферу: ${scopeName}`);
            scopeId = inserted.id;
            scopeCache.set(scopeName, scopeId);
          }
          scopeRelationsToInsert.push({ deviceId: generatedDeviceId, scopeId });
        }

        // 8. Сбор пакета связей для Видов измерений
        const targetMeasTypes = parseMultipleNames(item.measurementTypesNames);
        for (const mTypeName of targetMeasTypes) {
          let mTypeId = measTypeCache.get(mTypeName);
          if (!mTypeId) {
            const [inserted] = await tx
              .insert(measurementTypes)
              .values({ name: mTypeName })
              .returning();
            if (!inserted)
              throw new Error(`Не удалось создать вид измерений: ${mTypeName}`);
            mTypeId = inserted.id;
            measTypeCache.set(mTypeName, mTypeId);
          }
          measRelationsToInsert.push({
            deviceId: generatedDeviceId,
            measurementTypeId: mTypeId,
          });
        }

        // 9. Сбор пакета связей для Первичных эталонов
        const targetStandards = parseMultipleNames(item.primaryStandardsNames);
        for (const stdName of targetStandards) {
          let stdId = standardCache.get(stdName);
          if (!stdId) {
            const [inserted] = await tx
              .insert(primaryStandarts)
              .values({ name: stdName })
              .returning();
            if (!inserted)
              throw new Error(`Не удалось создать эталон: ${stdName}`);
            stdId = inserted.id;
            standardCache.set(stdName, stdId);
          }
          stdRelationsToInsert.push({
            deviceId: generatedDeviceId,
            primaryStandartId: stdId,
          });
        }

        importedCount++;
        existingDevicesSet.add(`${normSerial}_${normModel}`);
      }
      // =========================================================================
      // ЭТАП 3: МАССОВЫЙ ИНСЕРТ ВСЕХ ПАКЕТОВ И ПАРАЛЛЕЛЬНЫЙ ПЕРЕСЧЕТ КЭША МЕТРОЛОГИИ
      // =========================================================================
      if (devicesToInsert.length > 0) {
        // 1. Вставляем всю пачку приборов одним махом (Мгновенная операция на диске)
        await tx.insert(devices).values(devicesToInsert);

        if (scopeRelationsToInsert.length > 0) {
          await tx
            .insert(scopesToDevices)
            .values(scopeRelationsToInsert)
            .onConflictDoNothing();
        }
        if (measRelationsToInsert.length > 0) {
          await tx
            .insert(measurementTypesToDevices)
            .values(measRelationsToInsert)
            .onConflictDoNothing();
        }
        if (stdRelationsToInsert.length > 0) {
          await tx
            .insert(primaryStandartsToDevices)
            .values(stdRelationsToInsert)
            .onConflictDoNothing();
        }

        await Promise.all(
          devicesToInsert.map((d) => this.updateMetrologyCache(tx, d.id))
        );
      }
    });

    return importedCount;
  }
}
