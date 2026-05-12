-- qa_reviews: quality-monitoring samples for call QA per plan 14 task 16.
-- System-owned table — no RLS; written by the /admin/quality page on-demand
-- sampling and updated by the founder via the review form.

CREATE TABLE IF NOT EXISTS "qa_reviews" (
  "id"          bigserial PRIMARY KEY,
  "call_id"     uuid     NOT NULL REFERENCES "calls"("id") ON DELETE CASCADE,
  "org_id"      uuid     NOT NULL,
  "campaign_id" uuid,
  "status"      text     NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN ('pending_review', 'ok', 'needs_improvement')),
  "checklist"   jsonb,
  "note"        text,
  "reviewed_at" timestamptz,
  "reviewed_by" text,
  "sampled_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "qa_reviews_call_id_idx"    ON "qa_reviews" ("call_id");
CREATE INDEX        IF NOT EXISTS "qa_reviews_status_idx"     ON "qa_reviews" ("status");
CREATE INDEX        IF NOT EXISTS "qa_reviews_sampled_at_idx" ON "qa_reviews" ("sampled_at");
CREATE INDEX        IF NOT EXISTS "qa_reviews_org_id_idx"     ON "qa_reviews" ("org_id");
