import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function runMigration() {
  console.log('⏳ Запуск миграций на продакшене...');

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Миграции успешно применены!');
  } catch (error) {
    console.error('❌ Ошибка при применении миграций:', error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runMigration();
