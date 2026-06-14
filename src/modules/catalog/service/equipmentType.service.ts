import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateEquipmentTypeInput } from '../dto/CreateEquipmentTypeDto';
import { equipmentTypes } from '../models/equipmentType.model';
import {
  EquipmentTypeEntity,
  NewEquipmentType,
} from '../types/equipmentType.types';
import { getOrCache, invalidateCache, CACHE_KEYS } from '../../../utils/cache';

export class EquipmentTypeService {
  constructor(private db: DrizzleDB) {}

  async getEquipmentTypes(): Promise<EquipmentTypeEntity[]> {
    return getOrCache(CACHE_KEYS.EQUIPMENT_TYPES, () =>
      this.db.select().from(equipmentTypes).orderBy(asc(equipmentTypes.name))
    );
  }

  async createEquipmentType(input: CreateEquipmentTypeInput) {
    const equipmentTypeData: NewEquipmentType = {
      name: input.name.toLowerCase(),
    };
    const [equipmentType] = await this.db
      .insert(equipmentTypes)
      .values(equipmentTypeData)
      .returning();
    if (!equipmentType) {
      throw new Error('Failed to create equipmentType');
    }
    await invalidateCache(CACHE_KEYS.EQUIPMENT_TYPES);
    return equipmentType;
  }

  async deleteEquipmentType(id: string) {
    await this.db.delete(equipmentTypes).where(eq(equipmentTypes.id, id));
    await invalidateCache(CACHE_KEYS.EQUIPMENT_TYPES);
    return true;
  }
}
