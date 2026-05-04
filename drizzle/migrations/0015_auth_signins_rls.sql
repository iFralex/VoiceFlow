-- Enable Row Level Security on auth_signins so users can only read
-- their own signin fingerprints via the PostgREST API.
-- Writes are performed by the supabase-auth webhook via the system/service role
-- which bypasses RLS, so no INSERT policy is needed.

ALTER TABLE auth_signins ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_signins_self_select
  ON auth_signins FOR SELECT
  USING (user_id = auth.uid());
