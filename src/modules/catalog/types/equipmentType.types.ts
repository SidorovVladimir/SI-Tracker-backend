import { equipmentTypes } from '../models/equipmentType.model';

export type EquipmentTypeEntity = typeof equipmentTypes.$inferSelect;
export type NewEquipmentType = typeof equipmentTypes.$inferInsert;
