import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  MetrologyControlTypeEntity,
  NewMetrologyControlType,
} from '../types/metrologyControlType.types';
import { metrologyControleTypes } from '../models/metrologyControlType.model';
import { CreateMetrologyControlTypeInput } from '../dto/CreateMetrologyControlTypeDto';
import { getOrCache, invalidateCache, CACHE_KEYS } from '../../../utils/cache';

export class MetrologyControlTypeService {
  constructor(private db: DrizzleDB) {}

  async getMetrologyControlTypes(): Promise<MetrologyControlTypeEntity[]> {
    return getOrCache(CACHE_KEYS.METROLOGY_CONTROL_TYPES, () =>
      this.db
        .select()
        .from(metrologyControleTypes)
        .orderBy(asc(metrologyControleTypes.name))
    );
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
      throw new Error('Failed to create metrology control type');
    }
    await invalidateCache(CACHE_KEYS.METROLOGY_CONTROL_TYPES);
    return metrologyControlType;
  }

  async deleteMetrologyControlType(id: string) {
    await this.db
      .delete(metrologyControleTypes)
      .where(eq(metrologyControleTypes.id, id));
    await invalidateCache(CACHE_KEYS.METROLOGY_CONTROL_TYPES);
    return true;
  }
}
