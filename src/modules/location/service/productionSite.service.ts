import { DrizzleDB } from '../../../db/client';
import { eq } from 'drizzle-orm';
import { CreateProductionSiteInput } from '../dto/CreateProductionSiteDto';
import { productionSites } from '../models/productionSites.model';
import {
  NewProductionSite,
  ProductionSiteEntity,
} from '../types/productionSite.types';

export class ProductionSiteService {
  constructor(private db: DrizzleDB) {}
  async getProductionSites(): Promise<ProductionSiteEntity[]> {
    return await this.db.select().from(productionSites);
  }
  async getProductionSite(id: string): Promise<ProductionSiteEntity> {
    const [productionSite] = await this.db
      .select()
      .from(productionSites)
      .where(eq(productionSites.id, id));
    if (!productionSite) {
      throw new Error(`Производственный участок с ID ${id} не найден`);
    }
    return productionSite;
  }
  async createProductionSite(input: CreateProductionSiteInput) {
    const productionSiteData: NewProductionSite = {
      ...input,
    };
    const [productionSite] = await this.db
      .insert(productionSites)
      .values(productionSiteData)
      .returning();
    if (!productionSite) {
      throw new Error('Ошибка создания производственного участка');
    }
    return productionSite;
  }
}
