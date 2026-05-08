import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import {
  NewPrimaryStandart,
  PrimaryStandartEntity,
} from '../types/primaryStandart.types';
import { primaryStandarts } from '../models/primaryStandarts.model';
import { CreatePrimaryStandartInput } from '../dto/CreatePrimaryStandartDto';

export class PrimaryStandartService {
  constructor(private db: DrizzleDB) {}

  async getPrimaryStandarts(): Promise<PrimaryStandartEntity[]> {
    return await this.db.select().from(primaryStandarts);
  }

  async createPrimaryStandart(input: CreatePrimaryStandartInput) {
    const primaryStandartData: NewPrimaryStandart = {
      name: input.name.toLowerCase(),
    };
    const [primaryStandart] = await this.db
      .insert(primaryStandarts)
      .values(primaryStandartData)
      .returning();
    if (!primaryStandart) {
      throw new Error('Failed to create primary standart');
    }
    return primaryStandart;
  }

  async deletePrimaryStandart(id: string) {
    await this.db.delete(primaryStandarts).where(eq(primaryStandarts.id, id));
    return true;
  }
}
