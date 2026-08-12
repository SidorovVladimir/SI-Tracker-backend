import { Context } from '../../../context';
import { InspectionService } from '../service/inspection.service';

export const Query = {
  getInspectionPoolByMonth: async (
    _: unknown,
    {
      targetMonth,
      limit,
      offset,
    }: {
      targetMonth: string;
      limit: number;
      offset: number;
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new InspectionService(db).getInspectionPoolByMonth(
      targetMonth,
      limit,
      offset
    );
  },
};

export const Mutation = {
  createBulkInspection: async (
    _: unknown,
    {
      deviceIds,
    }: {
      deviceIds: string[];
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new InspectionService(db).createBulkInspection(
      deviceIds,
      currentUser.id
    );
  },
};
