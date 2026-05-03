-- Migration: User mirror trigger
-- Spec §7.2 — keep public.users in sync with auth.users
--
-- When Supabase creates a new user in auth.users (via magic-link signup,
-- invite, or admin API), this trigger automatically inserts a corresponding
-- row in public.users with:
--   - the same UUID primary key (so joins work without a lookup)
--   - the email address
--   - full_name extracted from raw_user_meta_data if the client provided it
--   - default locale 'it'
--
-- The function uses INSERT … ON CONFLICT DO NOTHING so that running the
-- trigger twice (e.g. after a manual backfill) is safe.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, locale, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(TRIM(NEW.raw_user_meta_data ->> 'full_name'), ''),
    'it',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Allow the trigger function to be owned by postgres/supabase_admin but called
-- when a row is inserted into auth.users (which is owned by supabase_auth_admin).
-- SECURITY DEFINER means it runs with the privileges of the defining user.

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ============================================================
-- Verification (run manually after applying):
--
--   -- 1. In Supabase Dashboard → Authentication → Users → "Add user"
--   --    Create a user with email test@example.com
--   --
--   -- 2. Confirm the mirror row exists:
--   SELECT id, email, full_name, locale, created_at
--   FROM public.users
--   WHERE email = 'test@example.com';
--   --
--   -- Expected: 1 row with locale = 'it' and full_name = NULL
--   --           (or the value passed via raw_user_meta_data.full_name)
-- ============================================================
