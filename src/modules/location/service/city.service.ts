import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateCityInput } from '../dto/CreateCityDto';
import { cities } from '../models/city.model';
import { CityEntity, NewCity } from '../types/city.types';
import { UpdateCityInput } from '../dto/UpdateCityDto';

export class CityService {
  constructor(private db: DrizzleDB) {}
  async getCities(): Promise<CityEntity[]> {
    return await this.db.select().from(cities);
  }

  async getCity(id: string): Promise<CityEntity> {
    const [city] = await this.db.select().from(cities).where(eq(cities.id, id));
    if (!city) {
      throw new Error(`Город с ID ${id} не найден`);
    }
    return city;
  }

  async createCity(input: CreateCityInput): Promise<CityEntity> {
    const cityData: NewCity = {
      name: input.name,
    };
    const [city] = await this.db.insert(cities).values(cityData).returning();
    if (!city) {
      throw new Error('Failed to create city');
    }
    return city;
  }

  async updateCity(id: string, input: UpdateCityInput): Promise<CityEntity> {
    const [city] = await this.db
      .update(cities)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(cities.id, id))
      .returning();

    if (!city) {
      throw new Error('Failed to update city');
    }
    return city;
  }

  async deleteCity(id: string): Promise<boolean> {
    await this.db.delete(cities).where(eq(cities.id, id));
    return true;
  }
}
