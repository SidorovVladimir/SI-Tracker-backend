import 'dotenv/config';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import * as schema from './schema';

// export const db = drizzlePg({
//   connection: process.env.DATABASE_URL!,
// });

export const db =
  process.env.DB_MODE === 'local'
    ? drizzlePglite(new PGlite(process.env.DATABASE_URL!), { schema })
    : drizzlePg({ connection: process.env.DATABASE_URL!, schema });

export type DrizzleDB = typeof db;
