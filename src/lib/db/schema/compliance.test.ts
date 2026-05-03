import { describe, expect, it } from 'vitest';

import { actorTypeEnum, auditLog } from './audit_log';
import { optOutRegistry, optOutSourceEnum } from './opt_out_registry';
import { rpoSnapshots } from './rpo_snapshots';
import { webhookEvents, webhookProviderEnum } from './webhook_events';

type Col = Record<string, unknown>;
type Tbl = Record<string, Col>;

describe('opt_out_registry schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(optOutRegistry);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('phone_e164');
    expect(cols).toContain('source');
    expect(cols).toContain('recorded_at');
  });

  it('optOutSourceEnum has correct values', () => {
    expect(optOutSourceEnum.enumValues).toEqual([
      'call_outcome',
      'dealer_input',
      'gdpr_request',
      'inbound_ivr',
    ]);
  });

  it('phone_e164 is not null', () => {
    const col = (optOutRegistry as unknown as Tbl).phone_e164!;
    expect(col.notNull).toBeTruthy();
  });
});

describe('rpo_snapshots schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(rpoSnapshots);
    expect(cols).toContain('phone_e164');
    expect(cols).toContain('is_blocked');
    expect(cols).toContain('last_checked_at');
  });

  it('has no org_id column (system-owned)', () => {
    const cols = Object.keys(rpoSnapshots);
    expect(cols).not.toContain('org_id');
  });

  it('is_blocked is not null', () => {
    const col = (rpoSnapshots as unknown as Tbl).is_blocked!;
    expect(col.notNull).toBeTruthy();
  });
});

describe('audit_log schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(auditLog);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('actor_user_id');
    expect(cols).toContain('actor_type');
    expect(cols).toContain('action');
    expect(cols).toContain('subject_type');
    expect(cols).toContain('subject_id');
    expect(cols).toContain('metadata');
    expect(cols).toContain('created_at');
  });

  it('actorTypeEnum has correct values', () => {
    expect(actorTypeEnum.enumValues).toEqual(['user', 'system', 'webhook']);
  });

  it('org_id is nullable', () => {
    const col = (auditLog as unknown as Tbl).org_id!;
    expect(col.notNull).toBeFalsy();
  });

  it('actor_user_id is nullable', () => {
    const col = (auditLog as unknown as Tbl).actor_user_id!;
    expect(col.notNull).toBeFalsy();
  });

  it('metadata is nullable', () => {
    const col = (auditLog as unknown as Tbl).metadata!;
    expect(col.notNull).toBeFalsy();
  });

  it('action is not null', () => {
    const col = (auditLog as unknown as Tbl).action!;
    expect(col.notNull).toBeTruthy();
  });
});

describe('webhook_events schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(webhookEvents);
    expect(cols).toContain('id');
    expect(cols).toContain('provider');
    expect(cols).toContain('provider_event_id');
    expect(cols).toContain('event_type');
    expect(cols).toContain('payload');
    expect(cols).toContain('received_at');
    expect(cols).toContain('processed_at');
    expect(cols).toContain('error');
  });

  it('webhookProviderEnum has correct values', () => {
    expect(webhookProviderEnum.enumValues).toEqual(['stripe', 'vapi', 'retell', 'twilio', 'supabase_auth']);
  });

  it('processed_at is nullable', () => {
    const col = (webhookEvents as unknown as Tbl).processed_at!;
    expect(col.notNull).toBeFalsy();
  });

  it('error is nullable', () => {
    const col = (webhookEvents as unknown as Tbl).error!;
    expect(col.notNull).toBeFalsy();
  });

  it('payload is not null', () => {
    const col = (webhookEvents as unknown as Tbl).payload!;
    expect(col.notNull).toBeTruthy();
  });

  it('has no org_id column (system-owned)', () => {
    const cols = Object.keys(webhookEvents);
    expect(cols).not.toContain('org_id');
  });
});
