// Migration runner — implementation arrives in plan 02.
// Run with: pnpm db:migrate
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString = process.env['DATABASE_DIRECT_URL'];
if (!connectionString) {
  console.error('DATABASE_DIRECT_URL is not set');
  process.exit(1);
}

let migrationClient: ReturnType<typeof postgres> | undefined;
let exitCode = 0;
try {
  migrationClient = postgres(connectionString, { max: 1 });
  await migrate(drizzle(migrationClient), { migrationsFolder: './drizzle/migrations' });
} catch (err) {
  console.error('Migration failed:', err);
  exitCode = 1;
} finally {
  try {
    await migrationClient?.end();
  } catch (endErr) {
    console.error('Failed to close migration connection:', endErr);
    exitCode = 1;
  }
}
process.exit(exitCode);
