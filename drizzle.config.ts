import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/db/schema/*.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: (() => {
      const url = process.env['DATABASE_DIRECT_URL'];
      if (!url) throw new Error('DATABASE_DIRECT_URL is required for drizzle-kit');
      return url;
    })(),
  },
} satisfies Config;
