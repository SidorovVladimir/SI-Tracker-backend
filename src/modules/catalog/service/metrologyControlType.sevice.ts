import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  MetrologyControlTypeEntity,
  NewMetrologyControlType,
} from '../types/metrologyControlType.types';
import { metrologyControleTypes } from '../models/metrologyControlType.model';
import { CreateMetrologyControlTypeInput } from '../dto/CreateMetrologyControlTypeDto';

export class MetrologyControlTypeService {
  constructor(private db: DrizzleDB) {}

  async getMetrologyControlTypes(): Promise<MetrologyControlTypeEntity[]> {
    return await this.db.select().from(metrologyControleTypes);
  }

  async createMetrologyControlType(input: CreateMetrologyControlTypeInput) {
    const metrologyControlTypeData: NewMetrologyControlType = {
      name: input.name.toLowerCase(),
    };
    const [metrologyControlType] = await this.db
      .insert(metrologyControleTypes)
      .values(metrologyControlTypeData)
      .returning();
    if (!metrologyControlType) {
      throw new Error('Failed to create measurementType');
    }
    return metrologyControlType;
  }

  async deleteMetrologyControlType(id: string) {
    await this.db
      .delete(metrologyControleTypes)
      .where(eq(metrologyControleTypes.id, id));
    return true;
  }
}
