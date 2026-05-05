/**
 * Inngest event name constants and payload types for the voice / call domain.
 *
 * NOTE: CALL_COMPLETED_EVENT and CALL_CLASSIFY_EVENT are also defined in
 * src/lib/services/calls.ts (they were introduced there to avoid a circular
 * dependency at the time).  The canonical source is here; the services file
 * re-exports them for backwards compatibility.
 */

export const CALL_COMPLETED_EVENT = 'call/completed' as const;
export const CALL_CLASSIFY_EVENT = 'call/classify' as const;

export interface CallCompletedData {
  callId: string;
  orgId: string;
  durationSeconds: number;
  endedReason: string;
  recordingUrl: string | null;
}

export interface CallClassifyData {
  callId: string;
  orgId: string;
}

export const APPOINTMENT_BOOKED_EVENT = 'appointment/booked' as const;
export const CALL_TRANSFERRED_EVENT = 'call/transferred' as const;

export interface AppointmentBookedData {
  callId: string;
  orgId: string;
  appointmentId: string;
}

export interface CallTransferredData {
  callId: string;
  orgId: string;
  reason: string;
}

// ─── Quality / QA events ─────────────────────────────────────────────────────

/**
 * Emitted when the inferred outcome (classifier) disagrees with the
 * tool-driven outcome set by the LLM during the call.  Consumed by the
 * QA dashboard (plan 14) for human review.
 */
export const QUALITY_OUTCOME_MISMATCH_EVENT = 'quality/outcome-mismatch' as const;

/**
 * Emitted when the AI Act disclosure phrase ("assistente vocale automatico")
 * is not found in the first 30 seconds of the call transcript.  Consumed by
 * the QA dashboard (plan 14) for human review; does not block billing.
 */
export const QUALITY_DISCLOSURE_MISSING_EVENT = 'quality/disclosure-missing' as const;

export interface QualityDisclosureMissingData {
  callId: string;
  orgId: string;
}

export interface QualityOutcomeMismatchData {
  callId: string;
  orgId: string;
  /** Outcome set by a tool invocation during the call (authoritative). */
  toolOutcome: string;
  /** Outcome inferred by the post-call transcript classifier. */
  inferredOutcome: string;
  /** Classifier confidence for the inferred outcome [0, 1]. */
  inferredConfidence: number;
  /** Brief classifier reasoning for auditing. */
  reasoning: string;
}
