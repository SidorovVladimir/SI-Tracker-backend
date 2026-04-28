import { UserService } from '../service/user.service';
import { ZodError } from 'zod';
import { formatZodErrors } from '../../../utils/errors';
import type { User } from '../user.types';
import { UpdateUserInputSchema } from '../dto/UpdateUserDto';
import { Context } from '../../../context';
import { CreateUserInputSchema } from '../dto/CreateUserDto';

export const Query = {
  users: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ): Promise<User[]> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new UserService(db).getUsers();
  },
  user: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<User> => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new UserService(db).getUser(id);
  },
};

export const Mutation = {
  updateUser: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ): Promise<User> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
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
    { db, currentUser }: Context
  ): Promise<User> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
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
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new UserService(db).deleteUser(id);
  },
};
