import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { PrimaryStandartService } from '../service/primaryStandart.service';
import { CreatePrimaryStandartInputSchema } from '../dto/CreatePrimaryStandartDto';

export const Query = {
  primaryStandarts: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new PrimaryStandartService(db).getPrimaryStandarts();
  },
};

export const Mutation = {
  createPrimaryStandart: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreatePrimaryStandartInputSchema.parse(input);

      return await new PrimaryStandartService(db).createPrimaryStandart(
        validatedInput
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updatePrimaryStandart: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deletePrimaryStandart: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new PrimaryStandartService(db).deletePrimaryStandart(id);
  },
};
