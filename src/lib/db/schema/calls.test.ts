import { describe, expect, it } from 'vitest';

import { callDirectionEnum, calls } from './calls';

type Col = Record<string, unknown>;
type Tbl = Record<string, Col>;

describe('calls schema — direction (plan 10 task 9)', () => {
  it('exposes the call_direction enum with outbound + inbound', () => {
    expect(callDirectionEnum.enumValues).toEqual(['outbound', 'inbound']);
  });

  it('has a direction column', () => {
    expect(Object.keys(calls)).toContain('direction');
  });

  it('direction column is not null', () => {
    const col = (calls as unknown as Tbl).direction!;
    expect(col.notNull).toBeTruthy();
  });

  it('direction defaults to outbound (campaign calls keep prior behaviour)', () => {
    const col = (calls as unknown as Tbl).direction!;
    expect(col.default).toBe('outbound');
  });

  it('org_id remains required (every call must be scoped to an org)', () => {
    const col = (calls as unknown as Tbl).org_id!;
    expect(col.notNull).toBeTruthy();
  });

  it('campaign_id is nullable (relaxed for inbound IVR rows in plan 10 task 11)', () => {
    const col = (calls as unknown as Tbl).campaign_id!;
    expect(col.notNull).toBeFalsy();
  });

  it('contact_id is nullable (relaxed for inbound IVR rows in plan 10 task 11)', () => {
    const col = (calls as unknown as Tbl).contact_id!;
    expect(col.notNull).toBeFalsy();
  });
});
