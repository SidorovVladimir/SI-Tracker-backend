import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { ScopeService } from '../service/scope.service';
import { CreateScopeInputSchema } from '../dto/CreateScopeDto';

export const Query = {
  scopes: async (_: unknown, __: unknown, { db }: Context) => {
    return await new ScopeService(db).getScopes();
  },
  scope: async (_: unknown, { id }: { id: string }, { db }: Context) => {},
};

export const Mutation = {
  createScope: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {
    try {
      const validatedInput = CreateScopeInputSchema.parse(input);

      return await new ScopeService(db).createScope(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateScope: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteScope: async (_: unknown, { id }: { id: string }, { db }: Context) => {
    return await new ScopeService(db).deleteScope(id);
  },
};
