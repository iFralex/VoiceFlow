import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema/*.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_DIRECT_URL'] ?? '',
  },
} satisfies Config;
