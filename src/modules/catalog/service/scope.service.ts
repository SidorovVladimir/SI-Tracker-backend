import { eq } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { NewScope, ScopeEntity } from '../types/scope.types';
import { scopes } from '../models/scope.model';
import { CreateScopeInput } from '../dto/CreateScopeDto';

export class ScopeService {
  constructor(private db: DrizzleDB) {}

  async getScopes(): Promise<ScopeEntity[]> {
    return await this.db.select().from(scopes);
  }

  async createScope(input: CreateScopeInput) {
    const scopeData: NewScope = {
      name: input.name.toLowerCase(),
    };
    const [scope] = await this.db.insert(scopes).values(scopeData).returning();
    if (!scope) {
      throw new Error('Failed to create measurementType');
    }
    return scope;
  }

  async deleteScope(id: string) {
    await this.db.delete(scopes).where(eq(scopes.id, id));
    return true;
  }
}
