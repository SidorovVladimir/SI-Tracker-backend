import { ZodError } from 'zod';
import { CreateCompanyInputSchema } from '../dto/CreateCompanyDto';
import { CompanyService } from '../service/company.service';
import { formatZodErrors } from '../../../utils/errors';
import { Context } from '../../../context';
import { UpdateCompanyInputSchema } from '../dto/UpdateCompanyDto';

export const Query = {
  companies: async (_: unknown, __: unknown, { db }: Context) => {
    return await new CompanyService(db).getCompanies();
  },

  company: async (_: unknown, { id }: { id: string }, { db }: Context) => {
    return await new CompanyService(db).getCompany(id);
  },
};

export const Mutation = {
  createCompany: async (
    _: unknown,
    { input }: { input: unknown },
    { db }: Context
  ) => {
    try {
      const validatedInput = CreateCompanyInputSchema.parse(input);

      return await new CompanyService(db).createCompany(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  updateCompany: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {
    try {
      const validatedInput = UpdateCompanyInputSchema.parse(input);

      return await new CompanyService(db).updateCompany(id, validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  deleteCompany: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {
    return await new CompanyService(db).deleteCompany(id);
  },
};
