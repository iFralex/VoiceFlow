import { describe, expect, it } from 'vitest';

import { webhookDeliveries } from './webhook_deliveries';
import { webhooksOutgoing } from './webhooks_outgoing';

type Col = Record<string, unknown>;
type Tbl = Record<string, Col>;

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
    const col = (webhooksOutgoing as Tbl).active;
    expect(col.default).toBe(true);
  });

  it('failure_count defaults to 0', () => {
    const col = (webhooksOutgoing as Tbl).failure_count;
    expect(col.default).toBe(0);
  });

  it('last_delivery_at is nullable', () => {
    const col = (webhooksOutgoing as Tbl).last_delivery_at;
    expect(col.notNull).toBeFalsy();
  });

  it('last_failure_at is nullable', () => {
    const col = (webhooksOutgoing as Tbl).last_failure_at;
    expect(col.notNull).toBeFalsy();
  });

  it('org_id is not null', () => {
    const col = (webhooksOutgoing as Tbl).org_id;
    expect(col.notNull).toBeTruthy();
  });

  it('url is not null', () => {
    const col = (webhooksOutgoing as Tbl).url;
    expect(col.notNull).toBeTruthy();
  });

  it('secret is not null', () => {
    const col = (webhooksOutgoing as Tbl).secret;
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
    const col = (webhookDeliveries as Tbl).attempt;
    expect(col.default).toBe(1);
  });

  it('status_code is nullable', () => {
    const col = (webhookDeliveries as Tbl).status_code;
    expect(col.notNull).toBeFalsy();
  });

  it('delivered_at is nullable', () => {
    const col = (webhookDeliveries as Tbl).delivered_at;
    expect(col.notNull).toBeFalsy();
  });

  it('error is nullable', () => {
    const col = (webhookDeliveries as Tbl).error;
    expect(col.notNull).toBeFalsy();
  });

  it('webhook_id is not null', () => {
    const col = (webhookDeliveries as Tbl).webhook_id;
    expect(col.notNull).toBeTruthy();
  });

  it('event_type is not null', () => {
    const col = (webhookDeliveries as Tbl).event_type;
    expect(col.notNull).toBeTruthy();
  });

  it('payload is not null', () => {
    const col = (webhookDeliveries as Tbl).payload;
    expect(col.notNull).toBeTruthy();
  });
});
