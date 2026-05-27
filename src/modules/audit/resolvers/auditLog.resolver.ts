import { Context } from '../../../context';
import { DeviceAuditLogService } from '../auditLog.service';

export const Query = {
  deviceAuditLogs: async (
    _: unknown,
    {
      filter,
      limit = 20,
      offset = 0,
    }: { filter?: any; limit?: number; offset?: number },
    { db, currentUser }: Context
  ) => {
    if (!currentUser) throw new Error('Не авторизован');

    if (currentUser.role !== 'admin' && !filter?.deviceId) {
      throw new Error(
        'Доступ запрещен: просматривать общий журнал аудита могут только администраторы'
      );
    }

    const auditService = new DeviceAuditLogService(db);
    return await auditService.getLogs({ filter, limit, offset });
  },
};
