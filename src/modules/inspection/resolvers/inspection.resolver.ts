import { Context } from '../../../context';
import { VerificationPlanningService } from '../../verification/service/verification.service';
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

  getInspectionBatchesArchive: async (
    _: unknown,
    {
      limit,
      offset,
      year,
    }: {
      limit: number;
      offset: number;
      year: number;
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    const planningService = new VerificationPlanningService(db);
    const inspectionService = new InspectionService(db, planningService);

    return await inspectionService.getInspectionBatchesArchive(
      limit,
      offset,
      year
    );
  },
};

export const Mutation = {
  createBulkInspection: async (
    _: unknown,
    {
      items,
      intervalMonths,
    }: {
      items: any[];
      intervalMonths: number;
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    return await new InspectionService(db).createBulkInspection(
      items,
      intervalMonths,
      currentUser.id
    );
  },
};
