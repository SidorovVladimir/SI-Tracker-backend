import { DrizzleDB } from '../../../db/client';
import { eq, sql } from 'drizzle-orm';
import { CreateProductionSiteInput } from '../dto/CreateProductionSiteDto';
import { productionSites } from '../models/productionSites.model';
import {
  NewProductionSite,
  ProductionSiteEntity,
  ProductionSiteSelect,
} from '../types/productionSite.types';
import { cities } from '../models/city.model';
import { companies } from '../models/company.model';
import { UpdateProductionSiteInput } from '../dto/UpdateProductionSiteDto';

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
      name: input.name.toLowerCase(),
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

  async deleteProductionSite(id: string) {
    await this.db.delete(productionSites).where(eq(productionSites.id, id));
    return true;
  }

  async getProductionSitesForSelect(): Promise<ProductionSiteSelect[]> {
    return await this.db
      .select({
        id: productionSites.id,
        name: sql<string>`

        ${productionSites.name} || ' (' || ${cities.name} || ' | ' || ${companies.name} || ')'
      `.as('name'),
        createdAt: productionSites.createdAt,
        updatedAt: productionSites.updatedAt,
      })
      .from(productionSites)
      .innerJoin(cities, eq(productionSites.cityId, cities.id))
      .innerJoin(companies, eq(productionSites.companyId, companies.id))
      .orderBy(productionSites.name);
  }

  async updateProductionSite(
    id: string,
    input: UpdateProductionSiteInput
  ): Promise<ProductionSiteEntity> {
    const [productionSite] = await this.db
      .update(productionSites)
      .set({ ...input, name: input.name.toLowerCase(), updatedAt: new Date() })
      .where(eq(productionSites.id, id))
      .returning();
    if (!productionSite) {
      throw new Error('Failed to update production site');
    }
    return productionSite;
  }
}
