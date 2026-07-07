import { Context } from '../../../context';
import { AnalyticsService } from '../service/analitycs.service';

export const Query = {
  getFinancialAnalytics: async (
    _: unknown,
    { year, month }: { year: number; month?: number | null },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) {
      throw new Error('Доступ запрещен. Требуется авторизация в системе.');
    }

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    try {
      const analyticsService = new AnalyticsService(db);

      const result = await analyticsService.getFinancialAnalytics(year, month);

      return result;
    } catch (error: any) {
      throw new Error(
        `Не удалось собрать финансовую статистику: ${error.message}`
      );
    }
  },
  getProductionAnalytics: async (
    _: unknown,
    { year, month }: { year: number; month?: number | null },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }
    return await new AnalyticsService(db).getProductionAnalytics(year, month);
  },

  getAdminDashboardStats: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    return await new AnalyticsService(db).getAdminDashboardStats();
  },
};
