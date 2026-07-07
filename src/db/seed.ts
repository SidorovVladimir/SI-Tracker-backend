import { migrate } from 'drizzle-orm/pglite/migrator';
import { hashPassword } from '../utils/auth';
import { db } from './client';
import {
  equipmentTypes,
  measurementTypes,
  metrologyControleTypes,
  primaryStandarts,
  scopes,
  statuses,
  users,
} from './schema';
import {
  initialEquipmentTypes,
  initialMeasurementKinds,
  initialMetrologicalControls,
  initialPrimaryStandards,
  initialSpheres,
  initialStatuses,
} from './initialData';

async function main() {
  console.log('🔄 Starting database initialization...');

  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('✅ Migrations applied');

  await db.transaction(async (tx) => {
    // Суперадминистратор
    const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD!);
    await tx
      .insert(users)
      .values({
        login: process.env.ADMIN_EMAIL!,
        firstName: process.env.ADMIN_FIRSTNAME!,
        lastName: process.env.ADMIN_LASTNAME!,
        passwordHash,
        role: 'superadmin',
      })
      .onConflictDoNothing();
    console.log('👤 Admin verified');

    // Метрологический контроль
    await tx
      .insert(metrologyControleTypes)
      .values(initialMetrologicalControls)
      .onConflictDoNothing();
    console.log('⚙️ Metrological controls populated');

    // Виды измерений
    await tx
      .insert(measurementTypes)
      .values(initialMeasurementKinds)
      .onConflictDoNothing();
    console.log('📐 Measurement kinds populated');

    // Типы оборудования
    await tx
      .insert(equipmentTypes)
      .values(initialEquipmentTypes)
      .onConflictDoNothing();
    console.log('📦 Equipment types populated');

    // Статусы оборудования
    await tx.insert(statuses).values(initialStatuses).onConflictDoNothing();
    console.log('🔄 Equipment statuses populated');

    // Сферы ГРОЕИ
    await tx.insert(scopes).values(initialSpheres).onConflictDoNothing();
    console.log('🌍 Spheres populated');

    // Первичные эталоны
    await tx
      .insert(primaryStandarts)
      .values(initialPrimaryStandards)
      .onConflictDoNothing();
    console.log('🔬 Primary standards populated');
  });

  console.log('🚀 Database initialization completed successfully!');
  process.exit(0);
}

main().catch((err) => {
  console.error('Critical initialization error:', err);
  process.exit(1);
});
