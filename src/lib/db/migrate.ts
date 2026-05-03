// Migration runner — implementation arrives in plan 02.
// Run with: pnpm db:migrate
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '@/lib/env';

const migrationClient = postgres(env.DATABASE_DIRECT_URL, { max: 1 });

try {
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle/migrations' });
  await migrationClient.end();
  process.exit(0);
} catch (err) {
  console.error('Migration failed:', err);
  await migrationClient.end();
  process.exit(1);
}
