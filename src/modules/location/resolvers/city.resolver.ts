import { ZodError } from 'zod';
import { CreateCityInputSchema } from '../dto/CreateCityDto';
import { CityService } from '../service/city.service';
import { formatZodErrors } from '../../../utils/errors';
import { CityEntity } from '../types/city.types';
import { Context } from '../../../context';
import { UpdateCityInputSchema } from '../dto/UpdateCityDto';

export const Query = {
  cities: async (_: unknown, __: unknown, { db, currentUser }: Context) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new CityService(db).getCities();
  },
  city: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new CityService(db).getCity(id);
  },
};

export const Mutation = {
  createCity: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ): Promise<CityEntity> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreateCityInputSchema.parse(input);
      return await new CityService(db).createCity(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateCity: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = UpdateCityInputSchema.parse(input);
      return await new CityService(db).updateCity(id, validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  deleteCity: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new CityService(db).deleteCity(id);
  },
};
