import { ZodError } from 'zod';
import { Context } from '../../../context';
import { CreateEquipmentTypeInputSchema } from '../dto/CreateEquipmentTypeDto';
import { EquipmentTypeService } from '../service/equipmentType.service';
import { formatZodErrors } from '../../../utils/errors';

export const Query = {
  equipmentTypes: async (_: unknown, __: unknown, { db }: Context) => {
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
    { db }: Context
  ) => {
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
    { db }: Context
  ) => {},
};
