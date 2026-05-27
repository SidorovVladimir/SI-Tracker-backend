import { and, eq, sql, desc } from 'drizzle-orm';
import { DrizzleDB } from '../../db/client';
import { deviceAuditLogs } from './auditLog.model';
import { users } from '../user/user.model';

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  model: 'Модель',
  serialNumber: 'Серийный номер',
  releaseDate: 'Дата выпуска',
  grsiNumber: 'Номер ГРСИ',
  measurementRange: 'Диапазон измерений',
  accuracy: 'Погрешность',
  inventoryNumber: 'Инвентарный номер',
  receiptDate: 'Дата поступления',
  manufacturer: 'Производитель',
  verificationInterval: 'Межповерочный интервал',
  archived: 'Архивный статус',
  nomenclature: 'Номенклатура',
  comment: 'Комментарий',
  statusId: 'Статус',
  productionSiteId: 'Производственный участок',
  equipmentTypeId: 'Тип оборудования',
  scopes: 'Области применения',
  primaryStandarts: 'Эталоны',
  measurementTypes: 'Виды измерений',
  verifications: 'Поверки',
};

interface LogActionArgs {
  deviceId: string;
  action: 'create' | 'update' | 'delete';
  oldData?: Record<string, any> | null;
  newData?: Record<string, any> | null;
  userId?: string | null;
}
// const cleanVerificationObject = (obj: any) => {
//   if (!obj || typeof obj !== 'object') return obj;

//   // Деструктуризацией выкидываем автоматически генерируемые поля базы данных
//   const { id, deviceId, createdAt, updatedAt, ...cleanData } = obj;

//   // Нормализуем даты внутри поверки, чтобы часовые пояса не давали ложных срабатываний
//   if (cleanData.date) cleanData.date = cleanData.date.toString().split('T')[0];
//   if (cleanData.verificationDate)
//     cleanData.verificationDate = cleanData.verificationDate
//       .toString()
//       .split('T')[0];

//   return cleanData;
// };
// const normalizeValue = (val: any) => {
//   if (val === null || val === undefined || val === '') return null;
//   if (Array.isArray(val) && val.length === 0) return null;

//   // ХАК ДЛЯ ДАТ: Если значение является объектом Date или ISO-строкой даты
//   if (val instanceof Date) {
//     return val.toISOString().split('T')[0]; // Отрезаем время, оставляем только "YYYY-MM-DD"
//   }

//   if (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val))) {
//     return new Date(val).toISOString().split('T')[0]; // Приводим к UTC и оставляем только "YYYY-MM-DD"
//   }

//   return val;
// };
// const normalizeValue = (val: any) => {
//   if (val === null || val === undefined || val === '') return null;
//   if (Array.isArray(val) && val.length === 0) return null;

//   // Если это объект Date из базы данных
//   if (val instanceof Date) {
//     const y = val.getFullYear();
//     const m = String(val.getMonth() + 1).padStart(2, '0');
//     const d = String(val.getDate()).padStart(2, '0');
//     return `${y}-${m}-${d}`; // Возвращает чистую локальную дату "YYYY-MM-DD"
//   }

//   // Если это ISO-строка с фронтенда (например, "2018-07-30T17:00:00.000Z")
//   if (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val))) {
//     const dateObj = new Date(val);
//     const y = dateObj.getFullYear();
//     const m = String(dateObj.getMonth() + 1).padStart(2, '0');
//     const d = dateObj.getDate();

//     // ВНИМАНИЕ: Если время ровно 17:00, 21:00 (сдвиг таймзоны),
//     // восстанавливаем реальный календарный день, который выбрал юзер.
//     // Если фронтенд шлет UTC, то локальные методы .getFullYear() / .getDate()
//     // вернут именно то, что отображалось на экране у пользователя в Сибири.
//     const localD = String(d).padStart(2, '0');
//     return `${y}-${m}-${localD}`;
//   }

//   return val;
// };
// const normalizeValue = (val: any) => {
//   if (val === null || val === undefined || val === '') return null;
//   if (Array.isArray(val) && val.length === 0) return null;

//   // Если это массив поверок — очищаем каждый объект внутри него и сортируем по какому-то стабильному полю (например, по номеру)
//   if (Array.isArray(val)) {
//     return val
//       .map(cleanVerificationObject)
//       .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
//   }

//   if (val instanceof Date) {
//     const y = val.getFullYear();
//     const m = String(val.getMonth() + 1).padStart(2, '0');
//     const d = String(val.getDate()).padStart(2, '0');
//     return `${y}-${m}-${d}`;
//   }

//   if (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val))) {
//     const dateObj = new Date(val);
//     const y = dateObj.getFullYear();
//     const m = String(dateObj.getMonth() + 1).padStart(2, '0');
//     const d = String(dateObj.getDate()).padStart(2, '0');
//     return `${y}-${m}-${d}`;
//   }

//   return val;
// };

// const isEqual = (a: any, b: any) => {
//   const normA = normalizeValue(a);
//   const normB = normalizeValue(b);

//   if (normA === null && normB === null) return true;

//   return JSON.stringify(normA) === JSON.stringify(normB);
// };

// src/device/services/device-audit-log.service.ts

// Очищает объект поверки от технических полей БД для честного сравнения с инпутом бэкенда
// const cleanVerificationObject = (obj: any) => {
//   if (!obj || typeof obj !== 'object') return obj;

//   // Выкидываем автоматически генерируемые поля базы данных
//   const { id, deviceId, createdAt, updatedAt, ...cleanData } = obj;

//   // Приводим все внутренние поля дат к единому строковому виду YYYY-MM-DD
//   const formatDateField = (dateVal: any) => {
//     if (!dateVal) return null;
//     const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
//     if (isNaN(d.getTime())) return null;
//     return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
//       2,
//       '0'
//     )}-${String(d.getDate()).padStart(2, '0')}`;
//   };

//   if ('date' in cleanData) cleanData.date = formatDateField(cleanData.date);
//   if ('verificationDate' in cleanData)
//     cleanData.verificationDate = formatDateField(cleanData.verificationDate);
//   if ('validUntil' in cleanData)
//     cleanData.validUntil = formatDateField(cleanData.validUntil);

//   return cleanData;
// };

// const normalizeValue = (val: any) => {
//   // 1. Все варианты пустоты приводим к null
//   if (val === null || val === undefined || val === '') return null;
//   if (Array.isArray(val) && val.length === 0) return null;

//   // 2. Если это массив (связи или поверки)
//   if (Array.isArray(val)) {
//     const isVerificationArray =
//       val.length > 0 && typeof val[0] === 'object' && val[0] !== null;

//     if (isVerificationArray) {
//       return val
//         .map(cleanVerificationObject)
//         .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
//     }

//     // Для массивов ID (scopes, measurementTypes) — просто сортируем их как строки
//     return val.map(String).sort();
//   }

//   // 3. Если это одиночный объект даты из БД
//   if (val instanceof Date) {
//     const y = val.getFullYear();
//     const m = String(val.getMonth() + 1).padStart(2, '0');
//     const d = String(val.getDate()).padStart(2, '0');
//     return `${y}-${m}-${d}`;
//   }

//   // 4. Если это одиночная ISO-строка даты с фронтенда
//   if (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val))) {
//     const dateObj = new Date(val);
//     const y = dateObj.getFullYear();
//     const m = String(dateObj.getMonth() + 1).padStart(2, '0');
//     const d = String(dateObj.getDate()).padStart(2, '0');
//     return `${y}-${m}-${d}`;
//   }

//   return val;
// };

// const isEqual = (a: any, b: any) => {
//   const normA = normalizeValue(a);
//   const normB = normalizeValue(b);

//   if (normA === null && normB === null) return true;

//   return JSON.stringify(normA) === JSON.stringify(normB);
// };

// export class DeviceAuditLogService {
//   constructor(private db: DrizzleDB) {}

//   // async logAction({
//   //   deviceId,
//   //   action,
//   //   oldData,
//   //   newData,
//   //   userId,
//   // }: LogActionArgs): Promise<void> {
//   //   try {
//   //     let finalOldData: Record<string, any> | null = null;
//   //     let finalNewData: Record<string, any> | null = null;
//   //     let description = '';

//   //     if (action === 'create') {
//   //       finalNewData = newData ?? null;
//   //       description = 'Прибор успешно добавлен в систему';
//   //     } else if (action === 'delete') {
//   //       finalOldData = oldData ?? null;
//   //       description = 'Прибор удален из системы';
//   //     } else if (action === 'update' && oldData && newData) {
//   //       const diffOld: Record<string, any> = {};
//   //       const diffNew: Record<string, any> = {};
//   //       const changedLabels: string[] = [];

//   //       const allKeys = Array.from(
//   //         new Set([...Object.keys(oldData), ...Object.keys(newData)])
//   //       );

//   //       for (const key of allKeys) {
//   //         if (key === 'updatedAt' || key === 'createdAt' || key === 'id')
//   //           continue;

//   //         const oldVal = oldData[key];
//   //         const newVal = newData[key];

//   //         if (Array.isArray(oldVal) || Array.isArray(newVal)) {
//   //           const oldArr = (oldVal || []).map(String).sort();
//   //           const newArr = (newVal || []).map(String).sort();

//   //           if (JSON.stringify(oldArr) !== JSON.stringify(newArr)) {
//   //             diffOld[key] = oldArr;
//   //             diffNew[key] = newArr;
//   //             changedLabels.push(FIELD_LABELS[key] || key);
//   //           }
//   //         } else {
//   //           const cleanOld =
//   //             typeof oldVal === 'string' ? oldVal.trim() : oldVal;
//   //           const cleanNew =
//   //             typeof newVal === 'string' ? newVal.trim() : newVal;

//   //           if (JSON.stringify(cleanOld) !== JSON.stringify(cleanNew)) {
//   //             diffOld[key] = cleanOld ?? null;
//   //             diffNew[key] = cleanNew ?? null;
//   //             changedLabels.push(FIELD_LABELS[key] || key);
//   //           }
//   //         }
//   //       }

//   //       if (changedLabels.length === 0) return;

//   //       finalOldData = diffOld;
//   //       finalNewData = diffNew;
//   //       description = `Изменены параметры: ${changedLabels.join(', ')}`;
//   //     }
//   //     await this.db.insert(deviceAuditLogs).values({
//   //       deviceId,
//   //       userId: userId,
//   //       action,
//   //       description,
//   //       oldData: finalOldData,
//   //       newData: finalNewData,
//   //     });
//   //   } catch (error) {
//   //     console.error('Критическая ошибка при записи аудит-лога прибора:', error);
//   //   }
//   // }
//   async logAction({
//     deviceId,
//     action,
//     oldData,
//     newData,
//     userId,
//   }: LogActionArgs): Promise<void> {
//     try {
//       let finalOldData: Record<string, any> | null = null;
//       let finalNewData: Record<string, any> | null = null;

//       const targetDevice = newData || oldData;
//       const deviceIdent = targetDevice
//         ? `«${targetDevice.name}» (Модель: ${targetDevice.model}, Зав. №: ${targetDevice.serialNumber})`
//         : `прибора с ID ${deviceId}`;

//       let description = '';

//       if (action === 'create') {
//         finalNewData = newData ?? null;
//         description = `Добавлен новый прибор ${deviceIdent}`;
//       } else if (action === 'delete') {
//         finalOldData = oldData ?? null;
//         description = `Удален прибор ${deviceIdent}`;
//       } else if (action === 'update' && oldData && newData) {
//         const diffOld: Record<string, any> = {};
//         const diffNew: Record<string, any> = {};
//         const changedLabels: string[] = [];

//         const allKeys = Array.from(
//           new Set([...Object.keys(oldData), ...Object.keys(newData)])
//         );

//         for (const key of allKeys) {
//           if (key === 'updatedAt' || key === 'createdAt' || key === 'id')
//             continue;

//           const oldVal = oldData[key];
//           const newVal = newData[key];

//           if (!isEqual(oldVal, newVal)) {
//             diffOld[key] = normalizeValue(oldVal);
//             diffNew[key] = normalizeValue(newVal);
//             changedLabels.push(FIELD_LABELS[key] || key);
//           }
//         }

//         if (changedLabels.length === 0) return;

//         finalOldData = diffOld;
//         finalNewData = diffNew;
//         description = `Изменены параметры прибора ${deviceIdent}: ${changedLabels.join(
//           ', '
//         )}`;
//       }

//       await this.db.insert(deviceAuditLogs).values({
//         deviceId,
//         userId: userId ?? null,
//         action,
//         description,
//         oldData: finalOldData,
//         newData: finalNewData,
//       });
//     } catch (error) {
//       console.error('Критическая ошибка при записи аудит-лога прибора:', error);
//     }
//   }

//   async getLogs(args: {
//     filter?: {
//       deviceId?: string;
//       userId?: string;
//       action?: 'create' | 'update' | 'delete';
//     };
//     limit: number;
//     offset: number;
//   }) {
//     const conditions = [];

//     if (args.filter?.deviceId) {
//       conditions.push(eq(deviceAuditLogs.deviceId, args.filter.deviceId));
//     }
//     if (args.filter?.userId) {
//       conditions.push(eq(deviceAuditLogs.userId, args.filter.userId));
//     }
//     if (args.filter?.action) {
//       conditions.push(eq(deviceAuditLogs.action, args.filter.action));
//     }

//     const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

//     const [countResult] = await this.db
//       .select({ count: sql<number>`count(*)::int` })
//       .from(deviceAuditLogs)
//       .where(whereClause);

//     const items = await this.db
//       .select({
//         id: deviceAuditLogs.id,
//         deviceId: deviceAuditLogs.deviceId,
//         action: deviceAuditLogs.action,
//         description: deviceAuditLogs.description,
//         // Превращаем jsonb обратно в строку, чтобы GraphQL без проблем её скушал
//         oldData: sql<string | null>`to_jsonb(${deviceAuditLogs.oldData})::text`,
//         newData: sql<string | null>`to_jsonb(${deviceAuditLogs.newData})::text`,
//         createdAt: deviceAuditLogs.createdAt,
//         user: users,
//       })
//       .from(deviceAuditLogs)
//       .leftJoin(users, eq(deviceAuditLogs.userId, users.id))
//       .where(whereClause)
//       .limit(args.limit)
//       .offset(args.offset)
//       .orderBy(desc(deviceAuditLogs.createdAt));

//     return {
//       items,
//       totalCount: countResult?.count ?? 0,
//     };
//   }
// }
// src/device/services/device-audit-log.service.ts

export class DeviceAuditLogService {
  constructor(private db: DrizzleDB) {}

  // async logAction({
  //   deviceId,
  //   action,
  //   oldData,
  //   newData,
  //   userId,
  // }: LogActionArgs): Promise<void> {
  //   try {
  //     let finalOldData: Record<string, any> | null = null;
  //     let finalNewData: Record<string, any> | null = null;

  //     const targetDevice = newData || oldData;
  //     const deviceIdent = targetDevice
  //       ? `«${targetDevice.name}» (Модель: ${targetDevice.model}, Зав. №: ${targetDevice.serialNumber})`
  //       : `прибора с ID ${deviceId}`;

  //     let description = '';

  //     if (action === 'create') {
  //       finalNewData = newData ?? null;
  //       description = `Добавлен новый прибор ${deviceIdent}`;
  //     } else if (action === 'delete') {
  //       finalOldData = oldData ?? null;
  //       description = `Удален прибор ${deviceIdent}`;
  //     } else if (action === 'update' && oldData && newData) {
  //       const diffOld: Record<string, any> = {};
  //       const diffNew: Record<string, any> = {};
  //       const changedLabels: string[] = [];

  //       // 1. СРАВНЕНИЕ ОБЫЧНЫХ ТЕКСТОВЫХ И ЧИСЛОВЫХ ПОЛЕЙ
  //       const scalarKeys = Object.keys({ ...oldData, ...newData }).filter(
  //         (k) =>
  //           ![
  //             'updatedAt',
  //             'createdAt',
  //             'id',
  //             'scopes',
  //             'measurementTypes',
  //             'primaryStandarts',
  //             'verifications',
  //           ].includes(k)
  //       );

  //       for (const key of scalarKeys) {
  //         const oldVal = oldData[key] === '' ? null : oldData[key] ?? null;
  //         const newVal = newData[key] === '' ? null : newData[key] ?? null;

  //         // Учитываем сдвиги дат YYYY-MM-DD
  //         const formatIfDate = (v: any) =>
  //           v instanceof Date
  //             ? v.toISOString().split('T')[0]
  //             : typeof v === 'string' && v.includes('T')
  //             ? v.split('T')[0]
  //             : v;

  //         if (formatIfDate(oldVal) !== formatIfDate(newVal)) {
  //           diffOld[key] = oldVal;
  //           diffNew[key] = newVal;
  //           changedLabels.push(FIELD_LABELS[key] || key);
  //         }
  //       }

  //       // 2. СРАВНЕНИЕ МАССИВОВ ID (scopes, measurementTypes, primaryStandarts)
  //       const arrayKeys = ['scopes', 'measurementTypes', 'primaryStandarts'];
  //       for (const key of arrayKeys) {
  //         const oldArr: string[] = oldData[key] || [];
  //         const newArr: string[] = newData[key] || [];

  //         const added = newArr.filter((id) => !oldArr.includes(id));
  //         const removed = oldArr.filter((id) => !newArr.includes(id));

  //         if (added.length > 0 || removed.length > 0) {
  //           // Записываем в аудит только дельту!
  //           diffOld[key] = { removed };
  //           diffNew[key] = { added };
  //           changedLabels.push(FIELD_LABELS[key] || key);
  //         }
  //       }

  //       // 3. СРАВНЕНИЕ МАССИВА ОБЪЕКТОВ (verifications)
  //       const oldVerifs: any[] = oldData.verifications || [];
  //       const newVerifs: any[] = newData.verifications || [];

  //       // Хелпер для текстовой идентификации поверки
  //       const getVerifLabel = (v: any) =>
  //         v.number || v.verificationNumber || 'Без номера';

  //       const verifChanges: any[] = [];

  //       // Ищем удаленные и измененные поверки
  //       oldVerifs.forEach((oldV) => {
  //         // Пытаемся сопоставить старую поверку с новой по номеру документа
  //         const newV = newVerifs.find(
  //           (n) => getVerifLabel(n) === getVerifLabel(oldV)
  //         );

  //         if (!newV) {
  //           verifChanges.push({ type: 'removed', label: getVerifLabel(oldV) });
  //         } else {
  //           // Если поверка осталась, проверяем, изменились ли её внутренние поля
  //           const fieldsToCompare = [
  //             'date',
  //             'verificationDate',
  //             'validUntil',
  //             'verificationOrganizationId',
  //             'metrologyControleTypeId',
  //           ];
  //           const innerDiff: Record<string, any> = {};

  //           fieldsToCompare.forEach((f) => {
  //             if (JSON.stringify(oldV[f]) !== JSON.stringify(newV[f])) {
  //               innerDiff[f] = { from: oldV[f], to: newV[f] };
  //             }
  //           });

  //           if (Object.keys(innerDiff).length > 0) {
  //             verifChanges.push({
  //               type: 'updated',
  //               label: getVerifLabel(oldV),
  //               changes: innerDiff,
  //             });
  //           }
  //         }
  //       });

  //       // Ищем новые (добавленные) поверки
  //       newVerifs.forEach((newV) => {
  //         const oldV = oldVerifs.find(
  //           (o) => getVerifLabel(o) === getVerifLabel(newV)
  //         );
  //         if (!oldV) {
  //           verifChanges.push({ type: 'added', label: getVerifLabel(newV) });
  //         }
  //       });

  //       if (verifChanges.length > 0) {
  //         diffOld['verifications'] = oldVerifs; // сохраняем для истории полные данные, если нужно
  //         diffNew['verifications'] = verifChanges; // а в изменения пишем только массив дельт!
  //         changedLabels.push(FIELD_LABELS['verifications'] || 'Поверки');
  //       }

  //       // Если ничего не поменялось — выходим
  //       if (changedLabels.length === 0) return;

  //       finalOldData = diffOld;
  //       finalNewData = diffNew;
  //       description = `Изменены параметры прибора ${deviceIdent}: ${changedLabels.join(
  //         ', '
  //       )}`;
  //     }

  //     await this.db.insert(deviceAuditLogs).values({
  //       deviceId,
  //       userId: userId ?? null,
  //       action,
  //       description,
  //       oldData: finalOldData,
  //       newData: finalNewData,
  //     });
  //   } catch (error) {
  //     console.error('Критическая ошибка при записи аудит-лога прибора:', error);
  //   }
  // }
  async logAction({
    deviceId,
    action,
    oldData,
    newData,
    userId,
  }: LogActionArgs): Promise<void> {
    try {
      // Берём любой доступный слепок прибора, чтобы получить его имя и номер
      const device = newData || oldData;
      const deviceIdent = device
        ? `«${device.name}» (Модель: ${device.model}, Зав. №: ${device.serialNumber})`
        : `с ID ${deviceId}`;

      // Формируем простое человекочитаемое описание факта действия
      let description = '';
      if (action === 'create')
        description = `Добавлен прибор в систему: ${deviceIdent}`;
      if (action === 'delete')
        description = `Удален прибор из системы: ${deviceIdent}`;
      if (action === 'update')
        description = `Обновлены данные прибора: ${deviceIdent}`;

      // Сохраняем в базу без лишней логики сравнения
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
        // Превращаем jsonb обратно в строку, чтобы GraphQL без проблем её скушал
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
}
