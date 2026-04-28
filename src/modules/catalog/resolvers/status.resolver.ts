import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { StatusService } from '../service/status.service';
import { CreateStatusInputSchema } from '../dto/CreateStatusDto';

export const Query = {
  statuses: async (_: unknown, __: unknown, { db, currentUser }: Context) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new StatusService(db).getAllStatuses();
  },
  status: async (_: unknown, { id }: { id: string }, { db }: Context) => {},
};

export const Mutation = {
  createStatus: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreateStatusInputSchema.parse(input);

      return await new StatusService(db).createStatus(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateStatus: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteStatus: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new StatusService(db).deleteStatus(id);
  },
};
