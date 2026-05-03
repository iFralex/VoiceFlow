import { describe, expect, it } from 'vitest';

import { organizations } from './organizations';

describe('organizations schema', () => {
  it('has expected columns', () => {
    const cols = Object.keys(organizations);
    expect(cols).toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('legal_name');
    expect(cols).toContain('vat_number');
    expect(cols).toContain('country');
    expect(cols).toContain('timezone');
    expect(cols).toContain('created_at');
    expect(cols).toContain('deleted_at');
  });

  it('has correct default for country', () => {
    const col = organizations.country;
    expect(col.default).toBe('IT');
  });

  it('has correct default for timezone', () => {
    const col = organizations.timezone;
    expect(col.default).toBe('Europe/Rome');
  });
});
