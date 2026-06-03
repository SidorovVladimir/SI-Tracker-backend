import { ZodError } from 'zod';
import { Context } from '../../../context';
import { formatZodErrors } from '../../../utils/errors';
import { VerificationPlanningService } from '../service/verificationPlanningService'; // Укажите ваш путь к сервису
import { CreateVerificationBatchSchema } from '../dto/CreateVerificationBatchDto';

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
    return await planningService.getVerificationBatches(year, status);
  },
  getDraftBatchesByMonth: async (
    _: unknown,
    { plannedMonth }: { plannedMonth: string },
    { db, currentUser }: Context
  ) => {
    // 1. Проверяем авторизацию
    if (!currentUser) throw new Error('Не авторизован');

    // 2. Вызываем облегченный метод сервиса
    const planningService = new VerificationPlanningService(db);
    return await planningService.getDraftBatchesByMonth(plannedMonth);
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

      return await planningService.createBatch(validatedInput);
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

    const planningService = new VerificationPlanningService(db);
    return await planningService.addDevicesToBatch(batchId, deviceIds);
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

    const planningService = new VerificationPlanningService(db);
    return await planningService.removeDevicesFromBatch(batchId, deviceIds);
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
};
