import { ZodError } from 'zod';
import { Context } from '../../../context';
import { CreateEquipmentTypeInputSchema } from '../dto/CreateEquipmentTypeDto';
import { EquipmentTypeService } from '../service/equipmentType.service';
import { formatZodErrors } from '../../../utils/errors';

export const Query = {
  equipmentTypes: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new EquipmentTypeService(db).getEquipmentTypes();
  },
  equipmentType: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {},
};

export const Mutation = {
  createEquipmentType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreateEquipmentTypeInputSchema.parse(input);

      return await new EquipmentTypeService(db).createEquipmentType(
        validatedInput
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateEquipmentType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteEquipmentType: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new EquipmentTypeService(db).deleteEquipmentType(id);
  },
};
