import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { statuses } from '../models/status.model';
import { CreateStatusInput } from '../dto/CreateStatusDto';
import { NewStatus, StatusEntity } from '../types/status.types';

export class StatusService {
  constructor(private db: DrizzleDB) {}

  async getAllStatuses(): Promise<StatusEntity[]> {
    return await this.db.select().from(statuses);
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
    return status;
  }

  async deleteStatus(id: string) {
    await this.db.delete(statuses).where(eq(statuses.id, id));
    return true;
  }
}
