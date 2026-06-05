import { and, eq, ilike, inArray, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity, NewDevice } from '../types/device.types';
import { devices } from '../models/device.model';
import { scopesToDevices } from '../../catalog/models/scope.model';
import { verifications } from '../models/verification.model';
import { UpdateDeviceInput } from '../dto/UpdateDeviceDto';
import { primaryStandartsToDevices } from '../../catalog/models/primaryStandarts.model';
import { measurementTypesToDevices } from '../../catalog/models/measurementType.model';
import { DeviceAuditLogService } from '../../audit/auditLog.service';
import { CreateVerificationDto } from '../dto/CreateVerificationDto';
import { statuses } from '../../catalog/models/status.model';

export class DeviceService {
  constructor(
    private db: DrizzleDB,
    private auditLogService?: DeviceAuditLogService
  ) {}
  async getDevices(): Promise<DeviceEntity[]> {
    return await this.db.select().from(devices);
  }

  // async getDevicesWithRelations() {
  //   const data = await this.db.query.devices.findMany({
  //     with: {
  //       status: true,
  //       equipmentType: true,
  //       productionSite: {
  //         with: {
  //           city: true,
  //           company: true,
  //         },
  //       },
  //       scopesToDevices: {
  //         with: {
  //           scope: true,
  //         },
  //       },
  //       primaryStandartsToDevices: {
  //         with: {
  //           primaryStandart: true,
  //         },
  //       },
  //       measurementTypesToDevices: {
  //         with: {
  //           measurementType: true,
  //         },
  //       },
  //       verifications: {
  //         with: {
  //           metrologyControleType: true,
  //           verificationOrganization: true,
  //         },
  //       },
  //     },
  //   });

  //   return data.map((device) => ({
  //     ...device,
  //     scopes: device.scopesToDevices.map((sd) => sd.scope),
  //     primaryStandarts: device.primaryStandartsToDevices.map(
  //       (psd) => psd.primaryStandart
  //     ),
  //     measurementTypes: device.measurementTypesToDevices.map(
  //       (mt) => mt.measurementType
  //     ),
  //   }));
  // }

  async getDevicesWithRelations(args: {
    limit: number;
    offset: number;
    filter?: any;
  }) {
    const { limit = 25, offset = 0, filter } = args;

    // Формируем условия SQL WHERE на основе пришедших с фронтенда фильтров
    const conditions = [eq(devices.archived, false)];
    // 1. Фильтр по наименованию (Регистронезависимый поиск ILIKE)
    if (filter?.deviceName) {
      conditions.push(ilike(devices.name, `%${filter.deviceName}%`));
    }

    // 2. Фильтр по заводскому номеру
    if (filter?.serialNumber) {
      conditions.push(ilike(devices.serialNumber, `%${filter.serialNumber}%`));
    }

    // 3. Фильтр по статусу (Состоянию) СИ через подзапрос к справочнику statuses
    if (filter?.status) {
      conditions.push(
        sql`${devices.statusId} IN (
          SELECT id FROM statuses WHERE name = ${filter.status}
        )`
      );
    }

    // 4. Фильтр по названию подразделения (Production Site)
    if (filter?.productionSite) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
          SELECT id FROM production_sites WHERE name ILIKE ${
            '%' + filter.productionSite + '%'
          }
        )`
      );
    }

    // 5. Фильтр по названию города (через таблицу подразделений production_sites)
    if (filter?.city) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
          SELECT ps.id FROM production_sites ps
          JOIN cities c ON ps.city_id = c.id
          WHERE c.name = ${filter.city}
        )`
      );
    }

    // 6. Фильтр по названию организации/компании (через таблицу подразделений)
    if (filter?.company) {
      conditions.push(
        sql`${devices.productionSiteId} IN (
          SELECT ps.id FROM production_sites ps
          JOIN companies comp ON ps.company_id = comp.id
          WHERE comp.name ILIKE ${'%' + filter.company + '%'}
        )`
      );
    }

    // 7. Фильтр по виду контроля актуальной поверки (подзапрос к verifications)
    if (filter?.metrologyControle) {
      conditions.push(
        sql`${devices.id} IN (
          SELECT v.device_id FROM verifications v
          JOIN metrology_controle_types mct ON v.metrology_controle_type_id = mct.id
          WHERE mct.name = ${filter.metrologyControle}
          AND v.valid_until = (
            SELECT MAX(valid_until) FROM verifications WHERE device_id = v.device_id
          )
        )`
      );
    }

    // 8. Фильтр по дате "Срок действия с..." (Сравниваем с valid_until последней поверки)
    if (filter?.dateStart) {
      conditions.push(
        sql`${devices.id} IN (
          SELECT v.device_id FROM verifications v
          WHERE v.valid_until >= ${new Date(filter.dateStart)}
          AND v.valid_until = (
            SELECT MAX(valid_until) FROM verifications WHERE device_id = v.device_id
          )
        )`
      );
    }

    // 9. Фильтр по дате "Срок действия до..."
    if (filter?.dateEnd) {
      conditions.push(
        sql`${devices.id} IN (
          SELECT v.device_id FROM verifications v
          WHERE v.valid_until <= ${new Date(filter.dateEnd)}
          AND v.valid_until = (
            SELECT MAX(valid_until) FROM verifications WHERE device_id = v.device_id
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
        status: { columns: { name: true } },
        productionSite: {
          columns: { name: true },
          with: {
            city: { columns: { name: true } },
            company: { columns: { name: true } },
          },
        },
        // 🌟 ОПТИМИЗАЦИЯ: База выгребает СТРОГО 1 последнюю поверку прибора!
        verifications: {
          // orderBy: (v, { desc }) => [desc(v.validUntil), desc(v.date)],
          orderBy: (v) => [sql`${v.date} DESC NULLS LAST`],
          limit: 1,
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

    return {
      items: items.map((d) => ({
        ...d,
        latestVerification: d.verifications[0] || null,
      })),
      totalCount: countResult?.count ?? 0,
    };
  }

  async getDevice(id: string) {
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, id),
      with: {
        status: true,
        equipmentType: true,
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
    const scopes = data?.scopesToDevices.map((sd) => sd.scope);
    const primaryStandarts = data?.primaryStandartsToDevices.map(
      (psd) => psd.primaryStandart
    );
    const measurementTypes = data?.measurementTypesToDevices.map(
      (mt) => mt.measurementType
    );
    return { ...data, scopes, primaryStandarts, measurementTypes };
  }

  private async getFlatAuditSnapshot(deviceId: string) {
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, deviceId),
      columns: {
        id: true,
        name: true,
        model: true,
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

  // async updateDevice(
  //   id: string,
  //   input: UpdateDeviceInput,
  //   userId: string
  // ): Promise<DeviceEntity> {
  //   // const oldDataSnapshot = await this.getDevice(id);
  //   const oldDataSnapshot = await this.getFlatAuditSnapshot(id);
  //   if (!oldDataSnapshot) throw new Error('Device not found');

  //   const normalize = (val?: string | null) =>
  //     val?.toLowerCase().trim() ?? null;

  //   const deviceData = {
  //     name: input.name.toLowerCase(),
  //     model: input.model.toLowerCase(),
  //     serialNumber: input.serialNumber.toLowerCase(),
  //     releaseDate: input.releaseDate,
  //     grsiNumber: input.grsiNumber?.toLowerCase() ?? null,
  //     measurementRange: input.measurementRange?.toLowerCase() ?? null,
  //     accuracy: input.accuracy?.toLowerCase() ?? null,
  //     inventoryNumber: input.inventoryNumber?.toLowerCase() ?? null,
  //     receiptDate: input.receiptDate,
  //     manufacturer: input.manufacturer?.toLowerCase() ?? null,
  //     verificationInterval: input.verificationInterval,
  //     archived: input.archived,
  //     nomenclature: input.nomenclature?.toLowerCase() ?? null,
  //     comment: input.comment?.toLowerCase() ?? null,
  //     statusId: input.statusId,
  //     productionSiteId: input.productionSiteId,
  //     equipmentTypeId: input.equipmentTypeId ?? null,
  //     updatedAt: new Date(),
  //   };

  //   const result = await this.db.transaction(async (tx) => {
  //     const [updateDevice] = await tx
  //       .update(devices)
  //       .set(deviceData)
  //       .where(eq(devices.id, id))
  //       .returning();

  //     if (!updateDevice) {
  //       throw new Error('Failed to update device');
  //     }

  //     await tx.delete(scopesToDevices).where(eq(scopesToDevices.deviceId, id));

  //     if (input.scopes && input.scopes.length > 0) {
  //       const valuesToInsert = input.scopes.map((sId) => ({
  //         deviceId: id,
  //         scopeId: sId,
  //       }));

  //       await tx.insert(scopesToDevices).values(valuesToInsert);
  //     }

  //     await tx
  //       .delete(primaryStandartsToDevices)
  //       .where(eq(primaryStandartsToDevices.deviceId, id));

  //     if (input.primaryStandarts && input.primaryStandarts.length > 0) {
  //       const valuesToInsert = input.primaryStandarts.map((psId) => ({
  //         deviceId: id,
  //         primaryStandartId: psId,
  //       }));

  //       await tx.insert(primaryStandartsToDevices).values(valuesToInsert);
  //     }

  //     await tx
  //       .delete(measurementTypesToDevices)
  //       .where(eq(measurementTypesToDevices.deviceId, id));

  //     if (input.measurementTypes && input.measurementTypes.length > 0) {
  //       const valuesToInsert = input.measurementTypes.map((mtId) => ({
  //         deviceId: id,
  //         measurementTypeId: mtId,
  //       }));

  //       await tx.insert(measurementTypesToDevices).values(valuesToInsert);
  //     }

  //     await tx.delete(verifications).where(eq(verifications.deviceId, id));

  //     if (input.verifications && input.verifications.length > 0) {
  //       const verificationsData = input.verifications.map((verification) => ({
  //         ...verification,
  //         metrologyControleTypeId: verification.metrologyControleTypeId ?? null,
  //         verificationOrganizationId:
  //           verification.verificationOrganizationId ?? null,
  //         deviceId: id,
  //       }));

  //       await tx.insert(verifications).values(verificationsData);
  //     }

  //     return updateDevice;
  //   });

  //   const newDataSnapshot = await this.getFlatAuditSnapshot(id);

  //   if (this.auditLogService) {
  //     // const newDataSnapshot = await this.getDevice(id);
  //     await this.auditLogService.logAction({
  //       deviceId: id,
  //       action: 'update',
  //       oldData: oldDataSnapshot,
  //       newData: newDataSnapshot,
  //       userId,
  //     });
  //   }

  //   return result;
  // }
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

      // await tx.delete(verifications).where(eq(verifications.deviceId, id));

      // if (input.verifications && input.verifications.length > 0) {
      //   const verificationsData = input.verifications.map((verification) => ({
      //     ...verification,
      //     metrologyControleTypeId: verification.metrologyControleTypeId ?? null,
      //     verificationOrganizationId:
      //       verification.verificationOrganizationId ?? null,
      //     deviceId: id,
      //   }));

      //   await tx.insert(verifications).values(verificationsData);
      // }

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

    // 🌟 ЗДЕСЬ ТРАНЗАКЦИЯ УСПЕШНО ЗАКРЫЛАСЬ, ВСЕ БЛОКИРОВКИ С БД СНЯТЫ!

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
      throw new Error('Прибор для удаления не найден');
    }

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

        await tx.delete(devices).where(eq(devices.id, id));
      });

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
      console.error(`[DeviceService] Failed to delete device ${id}:`, error);

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
        .set({ statusId: targetStatusId, updatedAt: now })
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
}
