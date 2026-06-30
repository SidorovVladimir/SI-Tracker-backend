import { ZodError } from 'zod';
import { Context } from '../../../context';
import {
  BudgetPlanFilterInputSchema,
  CreateBudgetPlanInputSchema,
  CreatePricelistInputSchema,
  UpdateBudgetPlanItemPriceInputSchema,
} from '../dto/budgetDto';
import { BudgetService } from '../service/budget.service';
import { formatZodErrors } from '../../../utils/errors';
import { pricelistQueue } from '../queues/pricelist.queue';

export const Query = {
  getBudgetMatrix: async (
    _: unknown,
    { targetYear, groupBy, companyId, cityId, siteId }: any,
    { db, currentUser }: any
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new BudgetService(db).getBudgetMatrix(targetYear, groupBy, {
      companyId,
      cityId,
      siteId,
    });
  },

  budgetPlan: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new BudgetService(db).getBudgetPlan(id);
  },

  budgetPlans: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new BudgetService(db).getBudgetPlans();
  },

  budgetPlanItems: async (
    _: unknown,
    {
      budgetId,
      limit,
      offset,
      filter,
    }: { budgetId: string; limit: number; offset: number; filter?: any },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    const validatedFilter = BudgetPlanFilterInputSchema.parse(filter);
    return await new BudgetService(db).getBudgetPlanItems({
      budgetId,
      limit,
      offset,
      filter: validatedFilter,
    });
  },

  pricelists: async (_: unknown, __: unknown, { db, currentUser }: Context) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new BudgetService(db).getPricelists();
  },

  pricelist: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new BudgetService(db).getPricelist(id);
  },

  getBudgetPlanDistribution: async (
    _: unknown,
    {
      budgetId,
      groupBy,
    }: { budgetId: string; groupBy: 'company' | 'city' | 'production_site' },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new BudgetService(db).getBudgetPlanDistribution(
      budgetId,
      groupBy
    );
  },

  getCsmTariffTrend: async (
    _: unknown,
    { siteId }: { siteId: string }, // 🎯 ИСПРАВЛЕНИЕ: деструктурируем именно siteId
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    // Передаем правильную переменную в метод сервиса
    return await new BudgetService(db).getCsmTariffTrend(siteId);
  },

  getVerificationRisks: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    // Делегируем вызов в чистый метод сервиса
    return await new BudgetService(db).getVerificationRisks();
  },
};

export const Mutation = {
  createBudgetPlan: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user')
      throw new Error('Доступ запрещен: требуются права администратора');

    try {
      const validatedInput = CreateBudgetPlanInputSchema.parse(input);
      return await new BudgetService(db).createBudgetPlan(validatedInput);
    } catch (err) {
      if (err instanceof ZodError)
        throw new Error(JSON.stringify(formatZodErrors(err)));
      throw err;
    }
  },

  updateBudgetPlanItemPrice: async (
    _: unknown,
    { input }: { input: unknown },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user')
      throw new Error('Доступ запрещен: требуются права администратора');

    try {
      const validatedInput = UpdateBudgetPlanItemPriceInputSchema.parse(input);
      return await new BudgetService(db).updateBudgetPlanItemPrice(
        validatedInput.itemId,
        validatedInput.manualPrice
      );
    } catch (err) {
      if (err instanceof ZodError)
        throw new Error(JSON.stringify(formatZodErrors(err)));
      throw err;
    }
  },

  approveBudgetPlan: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user')
      throw new Error('Доступ запрещен: требуются права администратора');

    return await new BudgetService(db).approveBudgetPlan(id);
  },

  deleteBudgetPlan: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user')
      throw new Error('Доступ запрещен: требуются права администратора');

    return await new BudgetService(db).deleteBudgetPlan(id);
  },

  createPricelist: async (
    _: unknown,
    { input }: { input: any },
    { currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: требуются права администратора');
    }

    try {
      // Валидируем входящий пакет через Zod DTO
      const validatedInput = CreatePricelistInputSchema.parse(input);

      // Разделяем тяжелый массив позиций и метаданные шапки
      const { items, ...metadata } = validatedInput;

      // Отправляем в фоновую очередь BullMQ
      const job = await pricelistQueue.add('pricelist-import-job', {
        metadata,
        items,
        userId: currentUser.id,
      });

      // Мгновенно возвращаем ответ клиенту (запрос выполнится за 5 миллисекунд)
      return {
        jobId: job.id,
        itemCount: items.length,
        message:
          'Прейскурант успешно принят сервером. Фоновая валидация и импорт позиций запущены.',
      };
    } catch (err) {
      if (err instanceof ZodError) {
        throw new Error(JSON.stringify(formatZodErrors(err)));
      }
      throw err;
    }
  },

  deletePricelist: async (
    _: unknown,
    { id }: { id: string },
    { db, currentUser }: Context
  ): Promise<boolean> => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user')
      throw new Error('Доступ запрещен: требуются права администратора');

    return await new BudgetService(db).deletePricelist(id);
  },
};
