import { eq, sql } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity, NewDevice } from '../types/device.types';
import { devices } from '../models/device.model';
import { scopes, scopesToDevices } from '../../catalog/models/scope.model';
import { productionSites } from '../../location/models/productionSites.model';
import { cities } from '../../location/models/city.model';
import { companies } from '../../location/models/company.model';
import { statuses } from '../../catalog/models/status.model';
import { metrologyControleTypes } from '../../catalog/models/metrologyControlType.model';
import { verifications } from '../models/verification.model';

export class DeviceService {
  constructor(private db: DrizzleDB) {}
  async getDevices(): Promise<DeviceEntity[]> {
    return await this.db.select().from(devices);
  }

  async getDevicesWithRelations() {
    const data = await this.db.query.devices.findMany({
      with: {
        status: true,
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
    }));
  }

  // async getCity(id: string): Promise<CityEntity> {
  //   const [city] = await this.db.select().from(cities).where(eq(cities.id, id));
  //   if (!city) {
  //     throw new Error(`Город с ID ${id} не найден`);
  //   }
  //   return city;
  // }

  async createDevice(input: CreateDeviceInput) {
    const deviceData = {
      name: input.name.toLowerCase(),
      model: input.model.toLowerCase(),
      serialNumber: input.serialNumber.toLowerCase(),
      releaseDate: input.releaseDate,
      grsiNumber: input.grsiNumber?.toLowerCase() ?? null,
      measurementRange: input.measurementRange?.toLowerCase() ?? null,
      accuracy: input.accuracy?.toLowerCase() ?? null,
      inventoryNumber: input.inventoryNumber.toLowerCase(),
      receiptDate: input.receiptDate,
      manufacturer: input.manufacturer?.toLowerCase() ?? null,
      verificationInterval: input.verificationInterval,
      archived: input.archived,
      nomenclature: input.nomenclature?.toLowerCase() ?? null,
      statusId: input.statusId,
      productionSiteId: input.productionSiteId,
      equipmentTypeId: input.equipmentTypeId,
      measurementTypeId: input.measurementTypeId,
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

      if (input.verifications && input.verifications.length > 0) {
        const verificationsData = input.verifications.map((verification) => ({
          ...verification,
          deviceId: newDevice.id,
        }));

        await tx.insert(verifications).values(verificationsData);
      }

      return newDevice;
    });
    return result;
  }

  // async updateCity(id: string, input: UpdateCityInput): Promise<CityEntity> {
  //   const [city] = await this.db
  //     .update(cities)
  //     .set({ name: input.name.toLowerCase(), updatedAt: new Date() })
  //     .where(eq(cities.id, id))
  //     .returning();

  //   if (!city) {
  //     throw new Error('Failed to update city');
  //   }
  //   return city;
  // }

  // async deleteCity(id: string): Promise<boolean> {
  //   await this.db.delete(cities).where(eq(cities.id, id));
  //   return true;
  // }
}
