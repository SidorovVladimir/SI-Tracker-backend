import { productionSites } from '../models/productionSites.model';

export type ProductionSiteEntity = typeof productionSites.$inferSelect;

export type NewProductionSite = typeof productionSites.$inferInsert;

export interface ProductionSiteSelect {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
