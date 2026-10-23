import { Context } from '../../../context';
import { DeviceAuditLogService } from '../../audit/auditLog.service';
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
      filter,
    }: {
      targetMonth: string;
      limit: number;
      offset: number;
      filter?: {
        serialNumber?: string;
      };
    },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    return await new InspectionService(db).getInspectionPoolByMonth(
      targetMonth,
      limit,
      offset,
      filter
    );
  },

  getInspectionBatchByNumber: async (
    _: unknown,
    { batchNumber }: { batchNumber: string },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role === 'user') {
      throw new Error('Доступ запрещен: нужны права администратора');
    }

    const planningService = new VerificationPlanningService(db);
    const inspectionService = new InspectionService(db, planningService);

    return await inspectionService.getInspectionBatchByNumber(batchNumber);
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

    const auditLogService = new DeviceAuditLogService(db);

    const inspectionService = new InspectionService(
      db,
      undefined,
      auditLogService,
      deviceService
    );
    return await inspectionService.createBulkInspection(items, currentUser.id);
  },
};
