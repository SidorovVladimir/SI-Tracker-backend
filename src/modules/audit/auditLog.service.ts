import { and, eq, sql, desc } from 'drizzle-orm';
import { DrizzleDB } from '../../db/client';
import { deviceAuditLogs } from './auditLog.model';
import { users } from '../user/user.model';

interface LogActionArgs {
  deviceId: string;
  action: 'create' | 'update' | 'delete';
  oldData?: any | null;
  newData?: any | null;
  userId?: string | null;
}

export class DeviceAuditLogService {
  constructor(private db: DrizzleDB) {}

  async logAction({
    deviceId,
    action,
    oldData,
    newData,
    userId,
  }: LogActionArgs): Promise<void> {
    try {
      const device = newData || oldData;
      const deviceIdent = device
        ? `«${device.name}» (Модель: ${device.model}, Зав. №: ${device.serialNumber})`
        : `с ID ${deviceId}`;

      let description = '';
      if (action === 'create')
        description = `Добавлен прибор в систему: ${deviceIdent}`;
      if (action === 'delete')
        description = `Удален прибор из системы: ${deviceIdent}`;
      if (action === 'update')
        description = `Обновлены данные прибора: ${deviceIdent}`;

      await this.db.insert(deviceAuditLogs).values({
        deviceId,
        userId: userId ?? null,
        action,
        description,
        oldData: oldData ?? null,
        newData: newData ?? null,
      });
    } catch (error) {
      console.error('Ошибка при записи аудит-лога прибора:', error);
    }
  }
  async getLogs(args: {
    filter?: {
      deviceId?: string;
      userId?: string;
      action?: 'create' | 'update' | 'delete';
    };
    limit: number;
    offset: number;
  }) {
    const conditions = [];

    if (args.filter?.deviceId) {
      conditions.push(eq(deviceAuditLogs.deviceId, args.filter.deviceId));
    }
    if (args.filter?.userId) {
      conditions.push(eq(deviceAuditLogs.userId, args.filter.userId));
    }
    if (args.filter?.action) {
      conditions.push(eq(deviceAuditLogs.action, args.filter.action));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(deviceAuditLogs)
      .where(whereClause);

    const items = await this.db
      .select({
        id: deviceAuditLogs.id,
        deviceId: deviceAuditLogs.deviceId,
        action: deviceAuditLogs.action,
        description: deviceAuditLogs.description,
        oldData: sql<string | null>`to_jsonb(${deviceAuditLogs.oldData})::text`,
        newData: sql<string | null>`to_jsonb(${deviceAuditLogs.newData})::text`,
        createdAt: deviceAuditLogs.createdAt,
        user: users,
      })
      .from(deviceAuditLogs)
      .leftJoin(users, eq(deviceAuditLogs.userId, users.id))
      .where(whereClause)
      .limit(args.limit)
      .offset(args.offset)
      .orderBy(desc(deviceAuditLogs.createdAt));

    return {
      items,
      totalCount: countResult?.count ?? 0,
    };
  }

  async deleteLog(id: string): Promise<boolean> {
    await this.db.delete(deviceAuditLogs).where(eq(deviceAuditLogs.id, id));
    return true;
  }
}
