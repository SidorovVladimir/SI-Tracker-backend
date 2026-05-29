import { eq, asc } from 'drizzle-orm';
import { DrizzleDB } from '../../../db/client';
import { CreateVerificationOrganizationInput } from '../dto/CreateVerificationOrganizationDto';
import {
  NewVerificationOrganization,
  VerificationOrganizationEntity,
} from '../types/verificationOrganization.types';
import { verificationOrganizations } from '../models/verificationOrganization.model';

export class VerificationOrganizationService {
  constructor(private db: DrizzleDB) {}

  async getVerificationOrganizations(): Promise<
    VerificationOrganizationEntity[]
  > {
    return await this.db
      .select()
      .from(verificationOrganizations)
      .orderBy(asc(verificationOrganizations.name));
  }

  async createVerificationOrganization(
    input: CreateVerificationOrganizationInput
  ) {
    const verificationOrganizationData: NewVerificationOrganization = {
      name: input.name.toLowerCase(),
    };
    const [verificationOrganization] = await this.db
      .insert(verificationOrganizations)
      .values(verificationOrganizationData)
      .returning();
    if (!verificationOrganization) {
      throw new Error('Failed to create verification organization');
    }
    return verificationOrganization;
  }

  async deleteVerificationOrganization(id: string) {
    await this.db
      .delete(verificationOrganizations)
      .where(eq(verificationOrganizations.id, id));
    return true;
  }
}
