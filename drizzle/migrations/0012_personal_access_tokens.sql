-- Personal Access Tokens for programmatic API access (spec §14.1)
-- Tokens are stored as SHA-256 hashes; the raw token is shown once on creation.

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,       -- SHA-256 hex of the raw bearer token
  prefix      TEXT NOT NULL,             -- first 8 chars of raw token for display
  scopes      TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at  TIMESTAMP WITH TIME ZONE,
  revoked_at  TIMESTAMP WITH TIME ZONE,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for hash lookups on every API request
CREATE INDEX personal_access_tokens_hash_idx ON personal_access_tokens(token_hash);
-- Index for listing by user/org
CREATE INDEX personal_access_tokens_user_org_idx ON personal_access_tokens(user_id, org_id);

-- RLS: users can only see their own tokens
ALTER TABLE personal_access_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_access_tokens_owner_select
  ON personal_access_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY personal_access_tokens_owner_delete
  ON personal_access_tokens
  FOR DELETE
  USING (user_id = auth.uid());
