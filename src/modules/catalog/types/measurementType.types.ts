import { measurementTypes } from '../models/measurementType.model';

export type MeasurementTypeEntity = typeof measurementTypes.$inferSelect;
export type NewMeasurementType = typeof measurementTypes.$inferInsert;
