-- Add import_status enum and column to contact_lists for tracking CSV ingestion progress.

CREATE TYPE import_status AS ENUM ('pending', 'parsing', 'completed', 'failed');

ALTER TABLE contact_lists
  ADD COLUMN import_status import_status NOT NULL DEFAULT 'pending';
