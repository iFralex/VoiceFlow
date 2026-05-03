-- Test database initialisation script.
-- Runs once when the container is first created.
-- Applies all Drizzle migrations and the RLS setup so the test database
-- mirrors the production schema exactly.

-- The actual migration is applied by running:
--   DATABASE_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/vox_auto_test pnpm db:migrate
-- after the container is healthy.

-- Enable the pg_stat_statements extension used by Supabase locally.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
