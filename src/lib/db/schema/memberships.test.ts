import { describe, expect, it } from 'vitest';

import { memberRoleEnum, memberships } from './memberships';
import { userLocaleEnum } from './users';

describe('memberships schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(memberships);
    expect(cols).toContain('id');
    expect(cols).toContain('org_id');
    expect(cols).toContain('user_id');
    expect(cols).toContain('role');
    expect(cols).toContain('invited_at');
    expect(cols).toContain('accepted_at');
  });
});

describe('member_role enum', () => {
  it('contains all four roles', () => {
    expect(memberRoleEnum.enumValues).toEqual(['owner', 'admin', 'operator', 'viewer']);
  });
});

describe('user_locale enum', () => {
  it('contains it and en', () => {
    expect(userLocaleEnum.enumValues).toEqual(['it', 'en']);
  });
});
