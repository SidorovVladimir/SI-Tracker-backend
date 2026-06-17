import { BudgetService } from '../service/budget.service';

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
};
