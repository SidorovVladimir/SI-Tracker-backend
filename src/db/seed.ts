import { migrate } from 'drizzle-orm/pglite/migrator';
import { hashPassword } from '../utils/auth';
import { db } from './client';
import { users } from './schema';

async function main() {
  await migrate(db, { migrationsFolder: './drizzle' });
  const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD!);

  await db
    .insert(users)
    .values({
      email: process.env.ADMIN_EMAIL!,
      firstName: process.env.ADMIN_FIRSTNAME!,
      lastName: process.env.ADMIN_LASTNAME!,
      passwordHash,
      role: 'admin',
    })
    .onConflictDoNothing();

  console.log('✅ Admin created');
  process.exit(0);
}

main();
