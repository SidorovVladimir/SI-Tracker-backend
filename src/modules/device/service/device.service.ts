import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateDeviceInput } from '../dto/CreateDeviceDto';
import { DeviceEntity, NewDevice } from '../types/device.types';
import { devices } from '../models/device.model';
import { scopesToDevices } from '../../catalog/models/scope.model';

export class DeviceService {
  constructor(private db: DrizzleDB) {}
  // async getCities(): Promise<CityEntity[]> {
  //   return await this.db.select().from(cities);
  // }

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
