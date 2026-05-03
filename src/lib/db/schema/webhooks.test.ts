import { describe, expect, it } from 'vitest';
import { webhooksOutgoing } from './webhooks_outgoing';
import { webhookDeliveries } from './webhook_deliveries';

describe('webhooks_outgoing schema', () => {
  it('has all required columns', () => {
    const cols = Object.keys(webhooksOutgoing);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('url');
    expect(cols).toContain('secret');
    expect(cols).toContain('event_types');
    expect(cols).toContain('active');
    expect(cols).toContain('created_at');
    expect(cols).toContain('last_delivery_at');
    expect(cols).toContain('last_failure_at');
    expect(cols).toContain('failure_count');
  });

  it('active defaults to true', () => {
    const col = (webhooksOutgoing as any).active;
    expect(col.default).toBe(true);
  });

  it('failure_count defaults to 0', () => {
    const col = (webhooksOutgoing as any).failure_count;
    expect(col.default).toBe(0);
  });

  it('last_delivery_at is nullable', () => {
    const col = (webhooksOutgoing as any).last_delivery_at;
    expect(col.notNull).toBeFalsy();
  });

  it('last_failure_at is nullable', () => {
    const col = (webhooksOutgoing as any).last_failure_at;
    expect(col.notNull).toBeFalsy();
  });

  it('org_id is not null', () => {
    const col = (webhooksOutgoing as any).org_id;
    expect(col.notNull).toBeTruthy();
  });

  it('url is not null', () => {
    const col = (webhooksOutgoing as any).url;
    expect(col.notNull).toBeTruthy();
  });

  it('secret is not null', () => {
    const col = (webhooksOutgoing as any).secret;
    expect(col.notNull).toBeTruthy();
  });
});

describe('webhook_deliveries schema', () => {
  it('has all required columns', () => {
    const cols = Object.keys(webhookDeliveries);
    expect(cols).toContain('id');
    expect(cols).toContain('webhook_id');
    expect(cols).toContain('event_type');
    expect(cols).toContain('payload');
    expect(cols).toContain('status_code');
    expect(cols).toContain('attempt');
    expect(cols).toContain('delivered_at');
    expect(cols).toContain('error');
  });

  it('attempt defaults to 1', () => {
    const col = (webhookDeliveries as any).attempt;
    expect(col.default).toBe(1);
  });

  it('status_code is nullable', () => {
    const col = (webhookDeliveries as any).status_code;
    expect(col.notNull).toBeFalsy();
  });

  it('delivered_at is nullable', () => {
    const col = (webhookDeliveries as any).delivered_at;
    expect(col.notNull).toBeFalsy();
  });

  it('error is nullable', () => {
    const col = (webhookDeliveries as any).error;
    expect(col.notNull).toBeFalsy();
  });

  it('webhook_id is not null', () => {
    const col = (webhookDeliveries as any).webhook_id;
    expect(col.notNull).toBeTruthy();
  });

  it('event_type is not null', () => {
    const col = (webhookDeliveries as any).event_type;
    expect(col.notNull).toBeTruthy();
  });

  it('payload is not null', () => {
    const col = (webhookDeliveries as any).payload;
    expect(col.notNull).toBeTruthy();
  });
});
