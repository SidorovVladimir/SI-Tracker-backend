import { Context } from '../../../context';
import { DeviceService } from '../../device/service/device.service';
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

  getInspectionCalendarSummary: async (
    _: unknown,
    __: unknown,
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');
    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    return await new InspectionService(db).getInspectionCalendarSummary();
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
    }: {
      items: any[];
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    const deviceService = new DeviceService(db);
    const inspectionService = new InspectionService(
      db,
      undefined,
      deviceService
    );
    return await inspectionService.createBulkInspection(items, currentUser.id);
  },
};
