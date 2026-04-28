import { ZodError } from 'zod';
import {
  CreateProductionSiteInput,
  CreateProductionSiteInputSchema,
} from '../dto/CreateProductionSiteDto';
import { ProductionSiteService } from '../service/productionSite.service';
import { formatZodErrors } from '../../../utils/errors';
import { Context } from '../../../context';
import { UpdateProductionSiteInputSchema } from '../dto/UpdateProductionSiteDto';

export const Query = {
  productionSites: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ProductionSiteService(db).getProductionSites();
  },
  productionSite: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ProductionSiteService(db).getProductionSite(id);
  },
  getProductionSitesForSelect: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new ProductionSiteService(db).getProductionSitesForSelect();
  },
};

export const Mutation = {
  createProductionSite: async (
    _: unknown,
    { input }: { input: CreateProductionSiteInput },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
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
  updateProductionSite: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validateInput = UpdateProductionSiteInputSchema.parse(input);
      return await new ProductionSiteService(db).updateProductionSite(
        id,
        validateInput
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
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new ProductionSiteService(db).deleteProductionSite(id);
  },
};
