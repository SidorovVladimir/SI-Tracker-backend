import { DrizzleDB } from '../../../db/client';
import { eq } from 'drizzle-orm';
import { CreateCompanyInput } from '../dto/CreateCompanyDto';
import { companies } from '../models/company.model';
import { CompanyEntity, NewCompany } from '../types/company.types';
import { UpdateCompanyInput } from '../dto/UpdateCompanyDto';

export class CompanyService {
  constructor(private db: DrizzleDB) {}
  async getCompanies(): Promise<CompanyEntity[]> {
    return await this.db.select().from(companies);
  }
  async getCompany(id: string): Promise<CompanyEntity> {
    const [company] = await this.db
      .select()
      .from(companies)
      .where(eq(companies.id, id));
    if (!company) {
      throw new Error(`Компания с ID ${id} не найдена`);
    }
    return company;
  }
  async createCompany(input: CreateCompanyInput): Promise<CompanyEntity> {
    const companyData: NewCompany = {
      ...input,
    };
    const [company] = await this.db
      .insert(companies)
      .values(companyData)
      .returning();
    if (!company) {
      throw new Error('Failed to create company');
    }
    return company;
  }

  async updateCompany(
    id: string,
    input: UpdateCompanyInput
  ): Promise<CompanyEntity> {
    const [company] = await this.db
      .update(companies)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    if (!company) {
      throw new Error('Failed to update company');
    }
    return company;
  }

  async deleteCompany(id: string): Promise<boolean> {
    await this.db.delete(companies).where(eq(companies.id, id));
    return true;
  }
}
