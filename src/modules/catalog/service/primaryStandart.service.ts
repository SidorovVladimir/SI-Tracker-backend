import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  NewPrimaryStandart,
  PrimaryStandartEntity,
} from '../types/primaryStandart.types';
import { primaryStandarts } from '../models/primaryStandarts.model';
import { CreatePrimaryStandartInput } from '../dto/CreatePrimaryStandartDto';
import { getOrCache, invalidateCache, CACHE_KEYS } from '../../../utils/cache';

export class PrimaryStandartService {
  constructor(private db: DrizzleDB) {}

  async getPrimaryStandarts(): Promise<PrimaryStandartEntity[]> {
    return getOrCache(CACHE_KEYS.PRIMARY_STANDARTS, () =>
      this.db
        .select()
        .from(primaryStandarts)
        .orderBy(asc(primaryStandarts.name))
    );
  }

  async createPrimaryStandart(input: CreatePrimaryStandartInput) {
    const primaryStandartData: NewPrimaryStandart = {
      name: input.name.toLowerCase(),
      description: input?.description?.toLowerCase() ?? null,
    };
    const [primaryStandart] = await this.db
      .insert(primaryStandarts)
      .values(primaryStandartData)
      .returning();
    if (!primaryStandart) {
      throw new Error('Failed to create primary standart');
    }
    await invalidateCache(CACHE_KEYS.PRIMARY_STANDARTS);
    return primaryStandart;
  }

  async deletePrimaryStandart(id: string) {
    await this.db.delete(primaryStandarts).where(eq(primaryStandarts.id, id));
    await invalidateCache(CACHE_KEYS.PRIMARY_STANDARTS);
    return true;
  }
}
