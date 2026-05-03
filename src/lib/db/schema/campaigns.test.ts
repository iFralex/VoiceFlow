import { describe, expect, it } from 'vitest';

import { campaignStatusEnum, campaigns } from './campaigns';
import { callOutcomeEnum, callProviderEnum, callStatusEnum, calls } from './calls';
import { appointmentStatusEnum, appointments } from './appointments';

describe('campaigns schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(campaigns);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('script_id');
    expect(cols).toContain('contact_list_id');
    expect(cols).toContain('name');
    expect(cols).toContain('status');
    expect(cols).toContain('concurrency_limit');
    expect(cols).toContain('time_window_start');
    expect(cols).toContain('time_window_end');
    expect(cols).toContain('estimated_max_cents');
    expect(cols).toContain('actual_cents');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('status defaults to draft', () => {
    const col = (campaigns as any).status;
    expect(col.default).toBe('draft');
  });

  it('concurrency_limit defaults to 5', () => {
    const col = (campaigns as any).concurrency_limit;
    expect(col.default).toBe(5);
  });

  it('actual_cents defaults to 0', () => {
    const col = (campaigns as any).actual_cents;
    expect(col.default).toBe(0);
  });

  it('estimated_max_cents is nullable', () => {
    const col = (campaigns as any).estimated_max_cents;
    expect(col.notNull).toBeFalsy();
  });

  it('campaignStatusEnum has correct values', () => {
    expect(campaignStatusEnum.enumValues).toEqual([
      'draft',
      'scheduled',
      'running',
      'paused',
      'completed',
      'cancelled',
    ]);
  });
});

describe('calls schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(calls);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('campaign_id');
    expect(cols).toContain('contact_id');
    expect(cols).toContain('provider');
    expect(cols).toContain('provider_call_id');
    expect(cols).toContain('status');
    expect(cols).toContain('outcome');
    expect(cols).toContain('outcome_confidence');
    expect(cols).toContain('billable_seconds');
    expect(cols).toContain('cost_cents');
    expect(cols).toContain('recording_path');
    expect(cols).toContain('transcript_path');
    expect(cols).toContain('transferred_to_agent');
    expect(cols).toContain('error_code');
    expect(cols).toContain('created_at');
  });

  it('status defaults to pending', () => {
    const col = (calls as any).status;
    expect(col.default).toBe('pending');
  });

  it('transferred_to_agent defaults to false', () => {
    const col = (calls as any).transferred_to_agent;
    expect(col.default).toBe(false);
  });

  it('nullable optional fields', () => {
    const nullableFields = [
      'provider_call_id',
      'outcome',
      'outcome_confidence',
      'billable_seconds',
      'cost_cents',
      'recording_path',
      'transcript_path',
      'error_code',
      'started_at',
      'ended_at',
    ];
    for (const field of nullableFields) {
      const col = (calls as any)[field];
      expect(col.notNull, `${field} should be nullable`).toBeFalsy();
    }
  });

  it('callProviderEnum has correct values', () => {
    expect(callProviderEnum.enumValues).toEqual(['vapi', 'retell', 'proprietary']);
  });

  it('callStatusEnum has correct values', () => {
    expect(callStatusEnum.enumValues).toEqual([
      'pending',
      'dialing',
      'in_progress',
      'completed',
      'failed',
      'no_answer',
      'voicemail',
      'busy',
    ]);
  });

  it('callOutcomeEnum has correct values', () => {
    expect(callOutcomeEnum.enumValues).toEqual([
      'interested',
      'not_interested',
      'appointment_booked',
      'wrong_number',
      'callback_requested',
      'voicemail_left',
      'do_not_call',
    ]);
  });
});

describe('appointments schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(appointments);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('call_id');
    expect(cols).toContain('contact_id');
    expect(cols).toContain('scheduled_at');
    expect(cols).toContain('notes');
    expect(cols).toContain('status');
    expect(cols).toContain('created_at');
  });

  it('notes is nullable', () => {
    const col = (appointments as any).notes;
    expect(col.notNull).toBeFalsy();
  });

  it('status defaults to booked', () => {
    const col = (appointments as any).status;
    expect(col.default).toBe('booked');
  });

  it('appointmentStatusEnum has correct values', () => {
    expect(appointmentStatusEnum.enumValues).toEqual([
      'booked',
      'confirmed',
      'cancelled',
      'no_show',
      'completed',
    ]);
  });
});
