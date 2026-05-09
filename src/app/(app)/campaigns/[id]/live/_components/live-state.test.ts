import { describe, expect, it } from 'vitest';

import type { CampaignLiveSnapshot } from '@/lib/services/campaign-live';

import {
  applyCall,
  callRecordFromRealtimeRow,
  initialStateFromSnapshot,
  sortCallsForDisplay,
  type CallRecord,
} from './live-state';

const baseSnapshot: CampaignLiveSnapshot = {
  totalCalls: 10,
  completedCalls: 3,
  inProgressCalls: 2,
  appointmentsBooked: 1,
  costCents: 500,
  recentCalls: [
    {
      id: 'a',
      contactName: 'Mario Rossi',
      phoneE164: '+391',
      status: 'in_progress',
      outcome: null,
      startedAtIso: '2026-05-09T10:00:00Z',
      endedAtIso: null,
      costCents: null,
      billableSeconds: null,
    },
    {
      id: 'b',
      contactName: 'Luca Bianchi',
      phoneE164: '+392',
      status: 'completed',
      outcome: 'interested',
      startedAtIso: '2026-05-09T09:00:00Z',
      endedAtIso: '2026-05-09T09:02:00Z',
      costCents: 50,
      billableSeconds: 120,
    },
  ],
};

function call(partial: Partial<CallRecord> & { id: string; status: CallRecord['status'] }): CallRecord {
  return {
    contactName: '',
    phoneE164: null,
    outcome: null,
    startedAtIso: null,
    endedAtIso: null,
    costCents: null,
    billableSeconds: null,
    ...partial,
  };
}

describe('initialStateFromSnapshot', () => {
  it('seeds counters and the calls map from the snapshot', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    expect(s.totalCalls).toBe(10);
    expect(s.completedCalls).toBe(3);
    expect(s.inProgressCalls).toBe(2);
    expect(s.appointmentsBooked).toBe(1);
    expect(s.costCents).toBe(500);
    expect(Object.keys(s.callsById)).toEqual(['a', 'b']);
  });
});

describe('applyCall — INSERT', () => {
  it('increments totalCalls and inProgressCalls when an active call appears', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({ id: 'c', status: 'dialing' }),
      'INSERT',
    );
    expect(next.totalCalls).toBe(11);
    expect(next.inProgressCalls).toBe(3);
    expect(next.completedCalls).toBe(3);
  });

  it('counts a brand-new completed call towards completedCalls', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({ id: 'c', status: 'completed', costCents: 75 }),
      'INSERT',
    );
    expect(next.totalCalls).toBe(11);
    expect(next.completedCalls).toBe(4);
    expect(next.costCents).toBe(575);
  });
});

describe('applyCall — UPDATE', () => {
  it('moves a call from in_progress to completed', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({
        id: 'a',
        status: 'completed',
        startedAtIso: '2026-05-09T10:00:00Z',
        endedAtIso: '2026-05-09T10:02:00Z',
        costCents: 100,
      }),
      'UPDATE',
    );
    expect(next.totalCalls).toBe(10);
    expect(next.inProgressCalls).toBe(1); // a moved out of in_progress
    expect(next.completedCalls).toBe(4); // a moved into terminal
    expect(next.costCents).toBe(600); // +100 delta
  });

  it('increments appointmentsBooked when outcome flips into appointment_booked', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({ id: 'b', status: 'completed', outcome: 'appointment_booked', costCents: 50 }),
      'UPDATE',
    );
    expect(next.appointmentsBooked).toBe(2);
    // Was already terminal, stays terminal
    expect(next.completedCalls).toBe(3);
    // Cost unchanged (was 50, still 50)
    expect(next.costCents).toBe(500);
  });

  it('does not adjust totalCalls for an UPDATE on a previously-unseen call', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({ id: 'unknown', status: 'completed', costCents: 200 }),
      'UPDATE',
    );
    expect(next.totalCalls).toBe(10);
    // Unseen UPDATE seeds the row but does not double-count.
    expect(next.completedCalls).toBe(3);
    expect(next.costCents).toBe(500);
    expect(next.callsById['unknown']).toBeDefined();
  });

  it('handles status reversion (terminal → non-terminal)', () => {
    const s = initialStateFromSnapshot(baseSnapshot);
    const next = applyCall(
      s,
      call({ id: 'b', status: 'in_progress', startedAtIso: '2026-05-09T09:00:00Z' }),
      'UPDATE',
    );
    expect(next.completedCalls).toBe(2); // b left terminal
    expect(next.inProgressCalls).toBe(3); // b joined active
  });
});

describe('callRecordFromRealtimeRow', () => {
  it('maps DB column names to the UI shape', () => {
    const row = callRecordFromRealtimeRow({
      id: 'x',
      status: 'dialing',
      outcome: null,
      from_number: '+39111',
      started_at: '2026-05-09T08:00:00Z',
      ended_at: null,
      cost_cents: null,
      billable_seconds: null,
    });
    expect(row).toMatchObject({
      id: 'x',
      status: 'dialing',
      contactName: '+39111',
      startedAtIso: '2026-05-09T08:00:00Z',
      endedAtIso: null,
    });
  });
});

describe('sortCallsForDisplay', () => {
  it('puts active calls first, then by started_at desc', () => {
    const calls: CallRecord[] = [
      call({ id: '1', status: 'completed', startedAtIso: '2026-05-09T08:00:00Z' }),
      call({ id: '2', status: 'in_progress', startedAtIso: '2026-05-09T07:00:00Z' }),
      call({ id: '3', status: 'completed', startedAtIso: '2026-05-09T09:00:00Z' }),
      call({ id: '4', status: 'dialing', startedAtIso: '2026-05-09T07:30:00Z' }),
    ];
    const sorted = sortCallsForDisplay(calls);
    expect(sorted.map((c) => c.id)).toEqual(['4', '2', '3', '1']);
  });

  it('respects the limit', () => {
    const calls: CallRecord[] = [
      call({ id: '1', status: 'in_progress' }),
      call({ id: '2', status: 'in_progress' }),
      call({ id: '3', status: 'in_progress' }),
    ];
    expect(sortCallsForDisplay(calls, 2)).toHaveLength(2);
  });
});
