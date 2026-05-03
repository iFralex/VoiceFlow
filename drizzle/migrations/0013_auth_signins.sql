-- Add supabase_auth to the webhook_provider enum for deduplicating auth webhook events
ALTER TYPE webhook_provider ADD VALUE IF NOT EXISTS 'supabase_auth';

-- Auth signin fingerprints for suspicious-login detection (spec §14.3)
-- Records IP + user-agent per user so we can alert on new device/location logins.
CREATE TABLE IF NOT EXISTS auth_signins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ip            TEXT NOT NULL,
  user_agent    TEXT NOT NULL DEFAULT '',
  signed_in_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX auth_signins_user_id_signed_in_at_idx
  ON auth_signins(user_id, signed_in_at DESC);
