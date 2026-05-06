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

  // campaign_id / contact_id stay NOT NULL until plan 10 task 11 relaxes them
  // for the inbound webhook handler. See 0028_calls_direction.sql for the
  // explicit handoff.
});
