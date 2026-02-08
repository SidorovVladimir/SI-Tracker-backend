import { ZodError } from 'zod';

import { formatZodErrors } from '../../../utils/errors';

import { Context } from '../../../context';
import { DeviceEntity } from '../types/device.types';
import { CreateDeviceInputSchema } from '../dto/CreateDeviceDto';
import { DeviceService } from '../service/device.service';

export const Query = {
  devices: async (_: unknown, __: unknown, { db }: Context) => {
    return await new DeviceService(db).getDevices();
  },

  devicesWithRelations: async (_: unknown, __: unknown, { db }: Context) => {
    return await new DeviceService(db).getDevicesWithRelations();
  },
  // city: async (_: unknown, { id }: { id: string }, { db }: Context) => {
  //   return await new CityService(db).getCity(id);
  // },
};

export const Mutation = {
  createDevice: async (
    _: unknown,
    { input }: { input: unknown },
    { db }: Context
  ) => {
    try {
      const validatedInput = CreateDeviceInputSchema.parse(input);
      return await new DeviceService(db).createDevice(validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  // updateCity: async (
  //   _: unknown,
  //   { id, input }: { id: string; input: unknown },
  //   { db }: Context
  // ) => {
  //   try {
  //     const validatedInput = UpdateCityInputSchema.parse(input);
  //     return await new CityService(db).updateCity(id, validatedInput);
  //   } catch (err) {
  //     if (err instanceof ZodError) {
  //       throw new Error(JSON.stringify(formatZodErrors(err)));
  //     }
  //     throw err;
  //   }
  // },
  // deleteCity: async (
  //   _: unknown,
  //   { id }: { id: string },
  //   { db }: Context
  // ): Promise<boolean> => {
  //   return await new CityService(db).deleteCity(id);
  // },
};
