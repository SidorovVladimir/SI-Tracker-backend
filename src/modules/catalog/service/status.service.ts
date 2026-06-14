import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { statuses } from '../models/status.model';
import { CreateStatusInput } from '../dto/CreateStatusDto';
import { NewStatus, StatusEntity } from '../types/status.types';
import { getOrCache, invalidateCache, CACHE_KEYS } from '../../../utils/cache';

export class StatusService {
  constructor(private db: DrizzleDB) {}

  async getAllStatuses(): Promise<StatusEntity[]> {
    return getOrCache(CACHE_KEYS.STATUSES, () =>
      this.db.select().from(statuses).orderBy(asc(statuses.name))
    );
  }

  async createStatus(input: CreateStatusInput) {
    const statusData: NewStatus = {
      name: input.name.toLowerCase(),
    };
    const [status] = await this.db
      .insert(statuses)
      .values(statusData)
      .returning();
    if (!status) {
      throw new Error('Failed to create measurementType');
    }
    await invalidateCache(CACHE_KEYS.STATUSES);
    return status;
  }

  async deleteStatus(id: string) {
    await this.db.delete(statuses).where(eq(statuses.id, id));
    await invalidateCache(CACHE_KEYS.STATUSES);
    return true;
  }
}
