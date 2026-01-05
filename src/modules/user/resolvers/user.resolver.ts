import { UserService } from '../service/user.service';
import { ZodError } from 'zod';
import { formatZodErrors } from '../../../utils/errors';
import type { User } from '../user.types';
import { UpdateUserInputSchema } from '../dto/UpdateUserDto';
import { Context } from '../../../context';
import { CreateUserInputSchema } from '../dto/CreateUserDto';

export const Query = {
  users: async (_: unknown, __: unknown, { db }: Context): Promise<User[]> => {
    return await new UserService(db).getUsers();
  },
  user: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ): Promise<User> => {
    return await new UserService(db).getUser(id);
  },
};

export const Mutation = {
  updateUser: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ): Promise<User> => {
    try {
      const validatedInput = UpdateUserInputSchema.parse(input);
      return await new UserService(db).updateUser(id, validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  createUser: async (
    _: unknown,
    { input }: { input: unknown },
    { db }: Context
  ): Promise<User> => {
    try {
      const validatedInput = CreateUserInputSchema.parse(input);
      return await new UserService(db).createUser(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  deleteUser: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ): Promise<boolean> => {
    return await new UserService(db).deleteUser(id);
  },
};
