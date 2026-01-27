import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { MeasurementTypeService } from '../service/measurementType.service';
import { CreateMeasurementTypeInputSchema } from '../dto/CreateMeasurementTypeDto';

export const Query = {
  measurementTypes: async (_: unknown, __: unknown, { db }: Context) => {
    return await new MeasurementTypeService(db).getMeasurementTypes();
  },
  measurementType: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {},
};

export const Mutation = {
  createMeasurementType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {
    try {
      const validatedInput = CreateMeasurementTypeInputSchema.parse(input);

      return await new MeasurementTypeService(db).createMeasurementType(
        validatedInput
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  updateMeasurementType: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db }: Context
  ) => {},
  deleteMeasurementType: async (
    _: unknown,
    { id }: { id: string },
    { db }: Context
  ) => {
    return await new MeasurementTypeService(db).deleteMeasurementType(id);
  },
};
