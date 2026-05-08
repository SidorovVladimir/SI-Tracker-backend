import { primaryStandarts } from '../models/primaryStandarts.model';

export type PrimaryStandartEntity = typeof primaryStandarts.$inferSelect;
export type NewPrimaryStandart = typeof primaryStandarts.$inferInsert;
