-- Migration: add attempt_number to calls
-- Tracks which retry attempt a call row represents (1-based).
-- Default 1 so all existing rows are treated as first attempts.

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;
