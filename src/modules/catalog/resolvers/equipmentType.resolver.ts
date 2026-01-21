import { Context } from '../../../context';

export const Query = {
  equipmentTypes: async (_: unknown, __: unknown, { db }: Context) => {},
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
  ) => {},
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
