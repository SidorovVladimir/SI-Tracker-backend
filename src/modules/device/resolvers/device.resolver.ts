import { ZodError } from 'zod';

import { formatZodErrors } from '../../../utils/errors';

import { Context } from '../../../context';
import { CreateDeviceInputSchema } from '../dto/CreateDeviceDto';
import { DeviceService } from '../service/device.service';
import { UpdateDeviceInputSchema } from '../dto/UpdateDeviceDto';

export const Query = {
  devices: async (_: unknown, __: unknown, { db, currentUser }: Context) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevices();
  },

  devicesWithRelations: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevicesWithRelations();
  },
  device: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevice(id);
  },
};

export const Mutation = {
  createDevice: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
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

  updateDevice: async (
    _: unknown,
    { id, input }: { id: string; input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = UpdateDeviceInputSchema.parse(input);
      return await new DeviceService(db).updateDevice(id, validatedInput);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },
  deleteDevice: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new DeviceService(db).deleteDevice(id);
  },
};
