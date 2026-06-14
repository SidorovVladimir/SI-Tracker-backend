import { and, eq, sql, desc } from 'drizzle-orm';
import { DrizzleDB } from '../../db/client';
import { deviceAuditLogs } from './auditLog.model';
import { users } from '../user/user.model';
import { NotificationService } from '../notification/service/notification.service';
import { auditLogQueue } from './queues/audit.queue';
interface LogActionArgs {
  deviceId: string;
  action:
    | 'create'
    | 'update'
    | 'delete'
    | 'assign_batch'
    | 'remove_batch'
    | 'verify';
  oldData?: any | null;
  newData?: any | null;
  userId?: string | null;
}

export class DeviceAuditLogService {
  private notificationService: NotificationService;
  constructor(private db: DrizzleDB) {
    this.notificationService = new NotificationService(this.db);
  }

  async logAction(args: LogActionArgs): Promise<void> {
    try {
      await auditLogQueue.add('write-audit-log', args);
    } catch (error) {
      console.error('Ошибка при добавлении аудит-лога в очередь:', error);
    }
  }
  async getLogs(args: {
    filter?: {
      deviceId?: string;
      userId?: string;
      action?:
        | 'create'
        | 'update'
        | 'delete'
        | 'assign_batch'
        | 'remove_batch'
        | 'verify';
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
