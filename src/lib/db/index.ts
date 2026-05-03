// Re-export the Drizzle client — schema and migrations arrive in plan 02.
export { db, dbForRequest } from './client';
export type { DB } from './client';
