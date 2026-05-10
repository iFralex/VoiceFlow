import { describe, expect, it } from 'vitest';
import { getRequestContext, getRequestId, runWithRequestContext } from './request-context';

describe('request-context', () => {
  it('returns undefined outside of a context', () => {
    expect(getRequestContext()).toBeUndefined();
    expect(getRequestId()).toBeUndefined();
  });

  it('propagates context to nested calls', () => {
    const ctx = { requestId: 'req-abc', orgId: 'org-1', userId: 'user-1' };
    runWithRequestContext(ctx, () => {
      expect(getRequestContext()).toEqual(ctx);
      expect(getRequestId()).toBe('req-abc');
    });
  });

  it('context does not leak outside runWithRequestContext', () => {
    runWithRequestContext({ requestId: 'req-xyz' }, () => {
      expect(getRequestId()).toBe('req-xyz');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('nested contexts are independent', () => {
    runWithRequestContext({ requestId: 'outer' }, () => {
      expect(getRequestId()).toBe('outer');
      runWithRequestContext({ requestId: 'inner' }, () => {
        expect(getRequestId()).toBe('inner');
      });
      expect(getRequestId()).toBe('outer');
    });
  });
});
