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
