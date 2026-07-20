import { ZodError } from 'zod';

import { formatZodErrors } from '../../../utils/errors';

import { Context } from '../../../context';
import { CreateDeviceInputSchema } from '../dto/CreateDeviceDto';
import { DeviceService } from '../service/device.service';
import { UpdateDeviceInputSchema } from '../dto/UpdateDeviceDto';
import { DeviceAuditLogService } from '../../audit/auditLog.service';
import {
  CreateVerificationModalInputSchema,
  FetchArshinVerificationsInputSchema,
} from '../dto/CreateVerificationDto';
import { SyncDeviceWithArshinInputSchema } from '../../arshin/dto/SyncDeviceWithArshinDto';
import { ImportDevicesExcelInputSchema } from '../dto/ImportDeviceItemDto';
import { GraphQLScalarType, Kind } from 'graphql';

import { arshinQueue } from '../queues/arshin.queue';
import { importQueue } from '../queues/import.queue';
import { ArshinService } from '../../arshin/service/arshin.service';

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description:
    'Кастомный скаляр для передачи произвольных JSON-объектов и массивов',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      try {
        return globalThis.JSON.parse(ast.value);
      } catch {
        return ast.value;
      }
    }
    return null;
  },
});

export { JSONScalar as JSON };

export const Query = {
  devices: async (_: unknown, __: unknown, { db, currentUser }: Context) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevices();
  },

  device: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevice(id);
  },
  devicesWithRelations: async (
    _: unknown,
    {
      limit,
      offset,
      filter,
    }: {
      limit: number;
      offset: number;
      filter?: {
        city?: string;
        company?: string;
        productionSite?: string;
        deviceName?: string;
        serialNumber?: string;
        status?: string;
        metrologyControle?: string;
        dateStart?: string;
        dateEnd?: string;
      };
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new DeviceService(db).getDevicesWithRelations({
      limit,
      offset,
      filter,
    });
  },

  executeRawSql: async (
    _: unknown,
    { sqlQuery }: { sqlQuery: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'superadmin') {
      throw new Error('Доступ запрещен: требуются права суперадминистратора');
    }

    const deviceService = new DeviceService(db);
    return await deviceService.executeRawSql(sqlQuery);
  },

  getDevicesBarcodeData: async (
    _: unknown,
    { ids }: { ids: string[] },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: требуются права администратора');
    }
    const deviceService = new DeviceService(db);
    return await deviceService.getDevicesBarcodeData(ids);
  },

  getJobStatus: async (
    _: unknown,
    { jobId }: { jobId: string },
    { currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: требуются права администратора');
    }
    // Ищем задачу в Redis через инстанс очереди
    const job = await arshinQueue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState(); //может быть 'completed', 'failed', 'active', 'waiting'

    return {
      id: job.id,
      progress: job.progress, // вернет наш объект { current, total }
      isCompleted: state === 'completed',
      isFailed: state === 'failed',
      failedReason: job.failedReason || null,
    };
  },

  fetchArshinVerifications: async (
    _: unknown,
    { input }: { input: unknown },
    { currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: требуются права администратора');
    }

    try {
      // 3. Валидация входных данных
      const validatedInput = FetchArshinVerificationsInputSchema.parse(input);

      // 4. Вызов бизнес-логики безопасного опроса Аршина
      const arshinService = new ArshinService();
      return await arshinService.fetchFlexibleVerificationsFromArshin(
        validatedInput.grsiNumber,
        validatedInput.serialNumber,
        validatedInput.count
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  findArshinDocumentUrl: async (
    _: unknown,
    { protocolNumber }: { protocolNumber: string },
    { currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    if (!protocolNumber || !protocolNumber.trim()) {
      throw new Error('Номер свидетельства/протокола не может быть пустым');
    }

    const arshinService = new ArshinService();
    return await arshinService.findSingleVerificationUrlByProtocol(
      protocolNumber
    );
  },
};

export const Mutation = {
  createDevice: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = CreateDeviceInputSchema.parse(input);
      const auditLogService = new DeviceAuditLogService(db);
      const deviceService = new DeviceService(db, auditLogService);

      return await deviceService.createDevice(validatedInput, currentUser.id);
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

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    try {
      const validatedInput = UpdateDeviceInputSchema.parse(input);

      const auditLogService = new DeviceAuditLogService(db);
      const deviceService = new DeviceService(db, auditLogService);

      return await deviceService.updateDevice(
        id,
        validatedInput,
        currentUser.id
      );
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

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    const auditLogService = new DeviceAuditLogService(db);
    return await new DeviceService(db, auditLogService).deleteDevice(
      id,
      currentUser.id
    );
  },

  createVerification: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    // 1. Проверка авторизации
    if (!currentUser) throw new Error('Не авторизован');

    // 2. Ограничение прав (только админы и метрологи могут вносить поверки)
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    try {
      // 3. Валидация входных данных через Zod
      const validatedInput = CreateVerificationModalInputSchema.parse(input);

      // 4. Вызов сервиса
      const auditLogService = new DeviceAuditLogService(db);
      const verificationService = new DeviceService(db, auditLogService);
      return await verificationService.createVerification(
        validatedInput,
        currentUser.id
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  syncDeviceWithArshin: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    // 1. Проверка авторизации
    if (!currentUser) throw new Error('Не авторизован');

    // 2. Ограничение прав доступа
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    try {
      const validatedInput = SyncDeviceWithArshinInputSchema.parse(input);

      // 4. Инициализация сервисов и вызов бизнес-логики
      const auditLogService = new DeviceAuditLogService(db);
      const deviceService = new DeviceService(db, auditLogService);

      return await deviceService.syncDeviceWithArshin(
        validatedInput,
        currentUser.id
      );
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  syncBatchWithArshin: async (
    _: unknown,
    { batchId }: { batchId: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    const auditLogService = new DeviceAuditLogService(db);
    const deviceService = new DeviceService(db, auditLogService);

    return await deviceService.syncBatchWithArshin(batchId, currentUser.id);
  },

  importDevicesFromExcel: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role !== 'superadmin') {
      throw new Error('Доступ запрещен: требуются права суперадминистратора');
    }

    const validatedInput = ImportDevicesExcelInputSchema.parse(input);

    // Отправляем в фоновую очередь вместо синхронного выполнения.
    // Это предотвращает таймаут GraphQL при большом количестве приборов.
    const job = await importQueue.add('excel-import-job', {
      items: validatedInput,
      userId: currentUser.id,
    });

    return {
      jobId: job.id,
      itemCount: validatedInput.length,
      message:
        'Файл Excel успешно принят. Обработка и импорт приборов запущены в фоновом режиме.',
    };
  },
};
