import { metrologyControleTypes } from '../models/metrologyControlType.model';

export type MetrologyControlTypeEntity =
  typeof metrologyControleTypes.$inferSelect;
export type NewMetrologyControlType =
  typeof metrologyControleTypes.$inferInsert;
