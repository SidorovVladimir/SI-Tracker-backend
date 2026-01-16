import { ZodError } from 'zod';
import {
  CreateProductionSiteInput,
  CreateProductionSiteInputSchema,
} from '../dto/CreateProductionSiteDto';
import { ProductionSiteService } from '../service/productionSite.service';
import { formatZodErrors } from '../../../utils/errors';
import { Context } from '../../../context';

export const Query = {
  productionSites: async (_: unknown, __: unknown, { db }: Context) => {
    return await new ProductionSiteService(db).getProductionSites();
  },
  productionSite: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {
    return await new ProductionSiteService(db).getProductionSite(id);
  },
  getProductionSitesForSelect: async (
    _: unknown,
    __: unknown,
    { db }: Context
  ) => {
    return await new ProductionSiteService(db).getProductionSitesForSelect();
  },
};

export const Mutation = {
  createProductionSite: async (
    _: unknown,
    { input }: { input: CreateProductionSiteInput },
    { db }: Context
  ) => {
    try {
      const validatedInput = CreateProductionSiteInputSchema.parse(input);
      return await new ProductionSiteService(db).createProductionSite(
        validatedInput
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  deleteProductionSite: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {
    return await new ProductionSiteService(db).deleteProductionSite(id);
  },
};
