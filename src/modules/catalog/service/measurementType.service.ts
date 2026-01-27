import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  MeasurementTypeEntity,
  NewMeasurementType,
} from '../types/measurementType.types';
import { CreateMeasurementTypeInput } from '../dto/CreateMeasurementTypeDto';
import { measurementTypes } from '../models/measurementType.model';

export class MeasurementTypeService {
  constructor(private db: DrizzleDB) {}

  async getMeasurementTypes(): Promise<MeasurementTypeEntity[]> {
    return await this.db.select().from(measurementTypes);
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
    return measurementType;
  }

  async deleteMeasurementType(id: string) {
    await this.db.delete(measurementTypes).where(eq(measurementTypes.id, id));
    return true;
  }
}
