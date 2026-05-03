// Migration runner — implementation arrives in plan 02.
// Run with: pnpm db:migrate
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { env } from '@/lib/env';

const migrationClient = postgres(env.DATABASE_DIRECT_URL, { max: 1 });

let exitCode = 0;
try {
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle/migrations' });
} catch (err) {
  console.error('Migration failed:', err);
  exitCode = 1;
} finally {
  await migrationClient.end();
}
process.exit(exitCode);
