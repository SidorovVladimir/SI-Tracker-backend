import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { StatusService } from '../service/status.service';
import { CreateStatusInputSchema } from '../dto/CreateStatusDto';

export const Query = {
  statuses: async (_: unknown, __: unknown, { db }: Context) => {
    return await new StatusService(db).getAllStatuses();
  },
  status: async (_: unknown, { id }: { id: string }, { db }: Context) => {},
};

export const Mutation = {
  createStatus: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {
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
  deleteStatus: async (_: unknown, { id }: { id: string }, { db }: Context) => {
    return await new StatusService(db).deleteStatus(id);
  },
};
