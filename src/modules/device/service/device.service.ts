import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity, NewDevice } from '../types/device.types';
import { devices } from '../models/device.model';
import { scopesToDevices } from '../../catalog/models/scope.model';
import { cities } from '../../location/models/city.model';
import { verifications } from '../models/verification.model';
import { UpdateDeviceInput } from '../dto/UpdateDeviceDto';
import { primaryStandartsToDevices } from '../../catalog/models/primaryStandarts.model';

export class DeviceService {
  constructor(private db: DrizzleDB) {}
  async getDevices(): Promise<DeviceEntity[]> {
    return await this.db.select().from(devices);
  }

  async getDevicesWithRelations() {
    const data = await this.db.query.devices.findMany({
      with: {
        status: true,
        equipmentType: true,
        measurementType: true,
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
        verifications: {
          with: {
            metrologyControleType: true,
          },
        },
      },
    });

    return data.map((device) => ({
      ...device,
      scopes: device.scopesToDevices.map((sd) => sd.scope),
      primaryStandarts: device.primaryStandartsToDevices.map(
        (psd) => psd.primaryStandart
      ),
    }));
  }

  async getDevice(id: string) {
    const data = await this.db.query.devices.findFirst({
      where: eq(devices.id, id),
      with: {
        status: true,
        measurementType: true,
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
        verifications: {
          with: {
            metrologyControleType: true,
          },
        },
      },
    });
    const scopes = data?.scopesToDevices.map((sd) => sd.scope);
    const primaryStandarts = data?.primaryStandartsToDevices.map(
      (psd) => psd.primaryStandart
    );
    return { ...data, scopes, primaryStandarts };
  }

  async createDevice(input: CreateDeviceInput) {
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
      measurementTypeId: input.measurementTypeId ?? null,
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

      if (input.verifications && input.verifications.length > 0) {
        const verificationsData = input.verifications.map((verification) => ({
          ...verification,
          metrologyControleTypeId: verification.metrologyControleTypeId ?? null,
          deviceId: newDevice.id,
        }));

        await tx.insert(verifications).values(verificationsData);
      }

      return newDevice;
    });
    return result;
  }

  async updateDevice(
    id: string,
    input: UpdateDeviceInput
  ): Promise<DeviceEntity> {
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
      measurementTypeId: input.measurementTypeId ?? null,
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

      await tx.delete(verifications).where(eq(verifications.deviceId, id));

      if (input.verifications && input.verifications.length > 0) {
        const verificationsData = input.verifications.map((verification) => ({
          ...verification,
          metrologyControleTypeId: verification.metrologyControleTypeId ?? null,
          deviceId: id,
        }));

        await tx.insert(verifications).values(verificationsData);
      }

      return updateDevice;
    });
    return result;
  }

  async deleteDevice(id: string): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .delete(scopesToDevices)
          .where(eq(scopesToDevices.deviceId, id));

        await tx
          .delete(primaryStandartsToDevices)
          .where(eq(primaryStandartsToDevices.deviceId, id));

        await tx.delete(verifications).where(eq(verifications.deviceId, id));

        await tx.delete(devices).where(eq(devices.id, id));
      });

      return true;
    } catch (error) {
      console.error(`[DeviceService] Failed to delete device ${id}:`, error);

      throw new Error(
        'Не удалось удалить устройство. Попробуйте обновить страницу.'
      );
    }
  }
}
