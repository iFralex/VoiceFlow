-- email_log: records each Resend send attempt for traceability (plan 13 task 1).
-- System-owned table — no RLS; written by the email adapter service-role only.

CREATE TABLE IF NOT EXISTS "email_log" (
  "id"         bigserial PRIMARY KEY,
  "to_address" text NOT NULL,
  "subject"    text NOT NULL,
  "resend_id"  text,
  "tags"       jsonb,
  "sent_at"    timestamptz NOT NULL DEFAULT now(),
  "error"      text
);

CREATE INDEX IF NOT EXISTS "email_log_sent_at_idx" ON "email_log" ("sent_at");
