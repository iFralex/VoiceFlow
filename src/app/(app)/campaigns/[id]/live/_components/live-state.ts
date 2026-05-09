import type {
  CampaignLiveCallRow,
  CampaignLiveSnapshot,
} from '@/lib/services/campaign-live';

export type CallRecord = CampaignLiveCallRow;

export type CampaignLiveState = {
  totalCalls: number;
  completedCalls: number;
  inProgressCalls: number;
  appointmentsBooked: number;
  costCents: number;
  /** All calls we've observed, keyed by id. */
  callsById: Record<string, CallRecord>;
};

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'no_answer',
  'voicemail',
  'busy',
]);
const ACTIVE_STATUSES = new Set(['dialing', 'in_progress']);

export function initialStateFromSnapshot(
  snapshot: CampaignLiveSnapshot,
): CampaignLiveState {
  const callsById: Record<string, CallRecord> = {};
  for (const c of snapshot.recentCalls) {
    callsById[c.id] = c;
  }
  return {
    totalCalls: snapshot.totalCalls,
    completedCalls: snapshot.completedCalls,
    inProgressCalls: snapshot.inProgressCalls,
    appointmentsBooked: snapshot.appointmentsBooked,
    costCents: snapshot.costCents,
    callsById,
  };
}

/**
 * Maps a raw DB call row (the shape Realtime delivers via
 * `payload.new` / `payload.old`) into the UI-friendly `CallRecord` shape.
 *
 * The realtime payload mirrors the table columns. We do not have the joined
 * contact fields here — the caller can choose to enrich later. For now we
 * fall back to the phone number for display name when a contact lookup is
 * missing.
 */
export function callRecordFromRealtimeRow(
  row: Record<string, unknown>,
  fallback: Partial<CallRecord> = {},
): CallRecord {
  return {
    id: String(row['id']),
    contactName:
      fallback.contactName ?? (row['from_number'] as string | null) ?? '',
    phoneE164: fallback.phoneE164 ?? null,
    status: row['status'] as CallRecord['status'],
    outcome: (row['outcome'] as CallRecord['outcome']) ?? null,
    startedAtIso:
      typeof row['started_at'] === 'string'
        ? (row['started_at'] as string)
        : null,
    endedAtIso:
      typeof row['ended_at'] === 'string'
        ? (row['ended_at'] as string)
        : null,
    costCents:
      typeof row['cost_cents'] === 'number'
        ? (row['cost_cents'] as number)
        : null,
    billableSeconds:
      typeof row['billable_seconds'] === 'number'
        ? (row['billable_seconds'] as number)
        : null,
  };
}

/**
 * Apply a single observed call row (insert or update) to the state, returning
 * the next state. Pure — no side effects. Counters are adjusted by computing
 * deltas against the previously-known snapshot of the same call.
 *
 * Calls observed for the first time during a Realtime UPDATE are treated as
 * "newly seen" — we record them but do not adjust totalCalls (the server
 * snapshot already counted them). Their status/outcome/cost values seed the
 * delta tracking from this point onward.
 */
export function applyCall(
  state: CampaignLiveState,
  next: CallRecord,
  eventType: 'INSERT' | 'UPDATE',
): CampaignLiveState {
  const prev = state.callsById[next.id];

  // Compute deltas
  let dTotal = 0;
  let dCompleted = 0;
  let dInProgress = 0;
  let dAppointments = 0;
  let dCost = 0;

  if (!prev) {
    // INSERT: a call we haven't seen — increment totalCalls.
    // UPDATE on an unseen row: don't change totalCalls (it was already counted
    // in the server snapshot), but seed the deltas from this point.
    if (eventType === 'INSERT') dTotal = 1;
    if (TERMINAL_STATUSES.has(next.status) && eventType === 'INSERT') dCompleted = 1;
    if (ACTIVE_STATUSES.has(next.status) && eventType === 'INSERT') dInProgress = 1;
    if (next.outcome === 'appointment_booked' && eventType === 'INSERT') {
      dAppointments = 1;
    }
    if (eventType === 'INSERT' && (next.costCents ?? 0) > 0) {
      dCost = next.costCents ?? 0;
    }
  } else {
    // Status transitions
    const wasTerminal = TERMINAL_STATUSES.has(prev.status);
    const isTerminal = TERMINAL_STATUSES.has(next.status);
    if (!wasTerminal && isTerminal) dCompleted = 1;
    else if (wasTerminal && !isTerminal) dCompleted = -1;

    const wasActive = ACTIVE_STATUSES.has(prev.status);
    const isActive = ACTIVE_STATUSES.has(next.status);
    if (!wasActive && isActive) dInProgress = 1;
    else if (wasActive && !isActive) dInProgress = -1;

    // Appointment outcome flips
    if (
      prev.outcome !== 'appointment_booked' &&
      next.outcome === 'appointment_booked'
    ) {
      dAppointments = 1;
    } else if (
      prev.outcome === 'appointment_booked' &&
      next.outcome !== 'appointment_booked'
    ) {
      dAppointments = -1;
    }

    // Cost delta — a call row's cost_cents only changes when it ends.
    const prevCost = prev.costCents ?? 0;
    const nextCost = next.costCents ?? 0;
    dCost = nextCost - prevCost;
  }

  return {
    totalCalls: state.totalCalls + dTotal,
    completedCalls: state.completedCalls + dCompleted,
    inProgressCalls: state.inProgressCalls + dInProgress,
    appointmentsBooked: state.appointmentsBooked + dAppointments,
    costCents: state.costCents + dCost,
    callsById: { ...state.callsById, [next.id]: next },
  };
}

/**
 * Sort calls for display: active calls first (dialing/in_progress), then by
 * started_at desc (most recently active first), then by id for stability.
 */
export function sortCallsForDisplay(
  calls: CallRecord[],
  limit?: number,
): CallRecord[] {
  const sorted = [...calls].sort((a, b) => {
    const aActive = ACTIVE_STATUSES.has(a.status) ? 0 : 1;
    const bActive = ACTIVE_STATUSES.has(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aTs = a.startedAtIso ?? '';
    const bTs = b.startedAtIso ?? '';
    if (aTs !== bTs) return bTs.localeCompare(aTs);
    return a.id.localeCompare(b.id);
  });
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
}
