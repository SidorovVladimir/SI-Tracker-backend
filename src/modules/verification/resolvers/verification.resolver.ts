import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { VerificationPlanningService } from '../service/verification.service'; // Укажите ваш путь к сервису

import { DeviceAuditLogService } from '../../audit/auditLog.service';

import { CreateVerificationModalInputSchema } from '../dto/CreateVerificationDto';
import { CreateVerificationBatchSchema } from '../dto/CreateVerificationBatchDto';
import { DeviceService } from '../../device/service/device.service';

export const Query = {
  // 1. Получить пул приборов для конкретного месяца (доступно всем авторизованным)
  getPlanningPoolByMonth: async (
    _: unknown,
    {
      targetMonth,
      companyDefaultLeadTime,
      limit,
      offset,
      controlTypeId,
    }: {
      targetMonth: string;
      companyDefaultLeadTime?: number;
      limit?: number;
      offset?: number;
      controlTypeId: string;
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.getPlanningPoolByMonth(
      targetMonth,
      companyDefaultLeadTime ?? 30,
      limit ?? 20,
      offset ?? 0,
      controlTypeId
    );
  },

  // 2. Получить статистику по месяцам на весь год (доступно всем авторизованным)
  getYearlyCalendarSummary: async (
    _: unknown,
    {
      year,
      companyDefaultLeadTime,
    }: { year: number; companyDefaultLeadTime?: number },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.getYearlyCalendarSummary(
      year,
      companyDefaultLeadTime ?? 30
    );
  },

  getVerificationBatches: async (
    _: unknown,
    { year, status }: { year?: number; status?: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    const planningService = new VerificationPlanningService(db);
    return await planningService.getVerificationBatches(
      year,
      status,
      'verification'
    );
  },
  getDraftBatchesByMonth: async (
    _: unknown,
    { plannedMonth }: { plannedMonth: string },
    { db, currentUser }: Context
  ) => {
    // 1. Проверяем авторизацию
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    // 2. Вызываем облегченный метод сервиса
    const planningService = new VerificationPlanningService(db);
    return await planningService.getDraftBatchesByMonth(plannedMonth);
  },

  getRepairPlanningPool: async (
    _: unknown,
    { limit, offset }: { limit?: number; offset?: number },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: нужны права администратора/мастера КИПиА'
      );
    }

    // 🌟 Создаем экземпляр сервиса приборов и вызываем созданный нами метод
    const planningService = new VerificationPlanningService(db);
    return await planningService.getRepairDevices({
      limit: limit ?? 20,
      offset: offset ?? 0,
    });
  },

  // 2. Получить список всех ремонтных ведомостей (Вторая вкладка Журнала ремонта)
  getRepairBatches: async (
    _: unknown,
    { year, status }: { year?: number; status?: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);

    return await planningService.getVerificationBatches(year, status, 'repair');
  },

  // 3. Получить черновики ремонтных накладных для выпадающего списка
  getRepairDraftBatches: async (
    _: unknown,
    __unknown: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    // Извлекаем черновики партий с явной фильтрацией по типу 'repair'
    const planningService = new VerificationPlanningService(db);
    return await planningService.getDraftBatchesByMonth(undefined, 'repair');
  },

  getDeviceRepairHistory: async (
    _: unknown,
    { deviceId }: { deviceId: string },
    { db, currentUser }: Context
  ) => {
    // Доступно всем авторизованным сотрудникам холдинга для просмотра
    if (!currentUser) throw new Error('Не авторизован');

    const planningService = new VerificationPlanningService(db);
    return await planningService.getDeviceRepairHistory(deviceId);
  },
};

export const Mutation = {
  // 3. Создать новую партию (только для админов/метрологов)
  createVerificationBatch: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    try {
      const validatedInput = CreateVerificationBatchSchema.parse(input);
      const planningService = new VerificationPlanningService(db);

      return await planningService.createBatch(validatedInput, currentUser.id);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  // 4. Добавить приборы в партию (только для админов/метрологов)
  addDevicesToBatch: async (
    _: unknown,
    { batchId, deviceIds }: { batchId: string; deviceIds: string[] },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const auditLogService = new DeviceAuditLogService(db);

    const planningService = new VerificationPlanningService(
      db,
      auditLogService
    );
    return await planningService.addDevicesToBatch(
      batchId,
      deviceIds,
      currentUser.id
    );
  },

  // 5. Удалить приборы из партии (только для админов/метрологов)
  removeDevicesFromBatch: async (
    _: unknown,
    { batchId, deviceIds }: { batchId: string; deviceIds: string[] },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const auditLogService = new DeviceAuditLogService(db);

    const planningService = new VerificationPlanningService(
      db,
      auditLogService
    );
    return await planningService.removeDevicesFromBatch(
      batchId,
      deviceIds,
      currentUser.id
    );
  },

  // 6. Изменить статус партии (только для админов/метрологов)
  updateBatchStatus: async (
    _: unknown,
    { id, status }: { id: string; status: 'draft' | 'sent' | 'completed' },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const validStatuses = ['draft', 'sent', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new Error('Невалидный статус партии');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.updateBatchStatus(id, status);
  },

  // 6. Удалить партию (только для админов/метрологов)
  deleteVerificationBatch: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.deleteBatch(id);
  },

  confirmArshinBuffer: async (
    _: unknown,
    { bufferId }: { bufferId: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const auditLogService = new DeviceAuditLogService(db);
    const deviceService = new DeviceService(db);
    const planningService = new VerificationPlanningService(
      db,
      auditLogService,
      deviceService
    );
    const result = await planningService.confirmArshinBufferRecord(
      bufferId,
      currentUser.id
    );
    return result.success;
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
      const deviceService = new DeviceService(db);
      const planningService = new VerificationPlanningService(
        db,
        auditLogService,
        deviceService
      );
      return await planningService.createVerification(
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

  // 1. Создать новую ремонтную ведомость по маске Р-ГОД/НОМЕР
  createRepairBatch: async (
    _: unknown,
    { input }: { input: any },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    try {
      const validatedInput = CreateVerificationBatchSchema.parse(input);
      const planningService = new VerificationPlanningService(db);

      return await planningService.createRepairBatch(
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

  // 2. Направить выбранное оборудование в ремонт (Включаем оранжевый чип 🛠️)
  addDevicesToRepairBatch: async (
    _: unknown,
    { batchId, deviceIds }: { batchId: string; deviceIds: string[] },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const auditLogService = new DeviceAuditLogService(db);
    const deviceService = new DeviceService(db); // Кэш-сервис

    const planningService = new VerificationPlanningService(
      db,
      auditLogService,
      deviceService
    );
    return await planningService.addDevicesToRepairBatch(
      batchId,
      deviceIds,
      currentUser.id
    );
  },

  // 3. Исключить оборудование из ремонта (С бережным восстановлением исходного брака)
  removeDevicesFromRepairBatch: async (
    _: unknown,
    { batchId, deviceIds }: { batchId: string; deviceIds: string[] },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const auditLogService = new DeviceAuditLogService(db);
    const deviceService = new DeviceService(db);

    const planningService = new VerificationPlanningService(
      db,
      auditLogService,
      deviceService
    );
    return await planningService.removeDevicesFromRepairBatch(
      batchId,
      deviceIds,
      currentUser.id
    );
  },

  // 4. Переключить статус самой ремонтной ведомости ('draft' -> 'sent' -> 'completed')
  updateRepairBatchStatus: async (
    _: unknown,
    { id, status }: { id: string; status: 'draft' | 'sent' | 'completed' },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const validStatuses = ['draft', 'sent', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new Error('Невалидный статус ремонтной ведомости');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.updateRepairBatchStatus(id, status);
  },

  // 5. Полностью удалить ремонтный черновик
  deleteRepairBatch: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);
    return await planningService.deleteBatch(id); // Вызовет наш безопасный deleteBatch с откатом
  },

  bulkScrapDevices: async (
    _: unknown,
    { deviceIds }: { deviceIds: string[] },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');

    // Списание — строгая административная процедура
    if (currentUser.role === 'user') {
      throw new Error(
        'Доступ запрещен: требуются права администратора/метролога'
      );
    }

    if (!deviceIds || deviceIds.length === 0) return true;

    const deviceService = new DeviceService(db);
    const planningService = new VerificationPlanningService(
      db,
      undefined,
      deviceService
    );

    // Вызываем созданный нами метод массового списания
    return await planningService.bulkScrapDevices(deviceIds, currentUser.id);
  },
};
