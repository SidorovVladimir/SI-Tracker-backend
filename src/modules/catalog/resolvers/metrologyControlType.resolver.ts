import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { MetrologyControlTypeService } from '../service/metrologyControlType.sevice';
import { CreateMetrologyControlTypeInputSchema } from '../dto/CreateMetrologyControlTypeDto';

export const Query = {
  metrologyControlTypes: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new MetrologyControlTypeService(db).getMetrologyControlTypes();
  },
  metrologyControlType: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {},
};

export const Mutation = {
  createMetrologyControlType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreateMetrologyControlTypeInputSchema.parse(input);

      return await new MetrologyControlTypeService(
        db
      ).createMetrologyControlType(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateMetrologyControlType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteMetrologyControlType: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new MetrologyControlTypeService(db).deleteMetrologyControlType(
      id
    );
  },
};
