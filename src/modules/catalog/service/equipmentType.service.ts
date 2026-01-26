import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateEquipmentTypeInput } from '../dto/CreateEquipmentTypeDto';
import { equipmentTypes } from '../models/equipmentType.model';
import {
  EquipmentTypeEntity,
  NewEquipmentType,
} from '../types/equipmentType.types';

export class EquipmentTypeService {
  constructor(private db: DrizzleDB) {}

  async getEquipmentTypes(): Promise<EquipmentTypeEntity[]> {
    return await this.db.select().from(equipmentTypes);
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
    return equipmentType;
  }

  async deleteEquipmentType(id: string) {
    await this.db.delete(equipmentTypes).where(eq(equipmentTypes.id, id));
    return true;
  }
}
