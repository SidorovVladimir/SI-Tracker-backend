import { statuses } from '../models/status.model';

export type StatusEntity = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
