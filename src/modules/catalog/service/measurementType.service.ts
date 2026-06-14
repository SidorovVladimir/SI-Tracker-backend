import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  MeasurementTypeEntity,
  NewMeasurementType,
} from '../types/measurementType.types';
import { CreateMeasurementTypeInput } from '../dto/CreateMeasurementTypeDto';
import { measurementTypes } from '../models/measurementType.model';
import { getOrCache, invalidateCache, CACHE_KEYS } from '../../../utils/cache';

export class MeasurementTypeService {
  constructor(private db: DrizzleDB) {}

  async getMeasurementTypes(): Promise<MeasurementTypeEntity[]> {
    return getOrCache(CACHE_KEYS.MEASUREMENT_TYPES, () =>
      this.db
        .select()
        .from(measurementTypes)
        .orderBy(asc(measurementTypes.name))
    );
  }

  async createMeasurementType(input: CreateMeasurementTypeInput) {
    const measurementTypeData: NewMeasurementType = {
      name: input.name.toLowerCase(),
    };
    const [measurementType] = await this.db
      .insert(measurementTypes)
      .values(measurementTypeData)
      .returning();
    if (!measurementType) {
      throw new Error('Failed to create measurementType');
    }
    await invalidateCache(CACHE_KEYS.MEASUREMENT_TYPES);
    return measurementType;
  }

  async deleteMeasurementType(id: string) {
    await this.db.delete(measurementTypes).where(eq(measurementTypes.id, id));
    await invalidateCache(CACHE_KEYS.MEASUREMENT_TYPES);
    return true;
  }
}
