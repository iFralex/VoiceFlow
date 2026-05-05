-- Migration: campaign_stats — per-campaign denormalised counters
-- Used by the aggregate-campaigns cron (every 5 min) for fast dashboard reads.

CREATE TABLE campaign_stats (
  campaign_id       uuid        PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  total_calls       integer     NOT NULL DEFAULT 0,
  pending_calls     integer     NOT NULL DEFAULT 0,
  dialing_calls     integer     NOT NULL DEFAULT 0,
  in_progress_calls integer     NOT NULL DEFAULT 0,
  completed_calls   integer     NOT NULL DEFAULT 0,
  failed_calls      integer     NOT NULL DEFAULT 0,
  outcome_appointment_booked integer NOT NULL DEFAULT 0,
  outcome_interested         integer NOT NULL DEFAULT 0,
  outcome_not_interested     integer NOT NULL DEFAULT 0,
  outcome_wrong_number       integer NOT NULL DEFAULT 0,
  outcome_callback           integer NOT NULL DEFAULT 0,
  outcome_voicemail          integer NOT NULL DEFAULT 0,
  outcome_do_not_call        integer NOT NULL DEFAULT 0,
  total_billed_seconds       integer NOT NULL DEFAULT 0,
  total_cost_cents           integer NOT NULL DEFAULT 0,
  last_aggregated_at timestamptz NOT NULL
);
