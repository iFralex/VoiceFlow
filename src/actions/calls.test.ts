import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetAuthContext,
  mockRequireCapability,
  mockWithOrgContext,
  mockRefundCall,
  mockSendEmail,
  mockRecordAudit,
  mockTx,
  setSelectResult,
  __testEnv,
} = vi.hoisted(() => {
  let nextSelectResult: unknown[] = [];

  function makeSelectChain() {
    const chain: Record<string, () => typeof chain> & { then?: unknown } = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
    };
    (chain as Record<string, unknown>).then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve(nextSelectResult).then(resolve, reject);
    return chain;
  }

  const mockTx = {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(),
  };

  const mockWithOrgContext = vi.fn(
    async (_orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  );
  const mockGetAuthContext = vi.fn().mockResolvedValue({
    orgId: 'org-1',
    userId: 'user-1',
    role: 'owner',
  });
  const mockRequireCapability = vi.fn().mockResolvedValue(undefined);
  const mockRefundCall = vi.fn().mockResolvedValue(undefined);
  const mockSendEmail = vi.fn().mockResolvedValue(undefined);
  const mockRecordAudit = vi.fn().mockResolvedValue(undefined);

  function setSelectResult(rows: unknown[]) {
    nextSelectResult = rows;
  }

  const __testEnv = { SUPPORT_EMAIL_ADDRESS: 'support@test.example' as string | undefined };

  return {
    mockGetAuthContext,
    mockRequireCapability,
    mockWithOrgContext,
    mockRefundCall,
    mockSendEmail,
    mockRecordAudit,
    mockTx,
    setSelectResult,
    __testEnv,
  };
});

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: (...args: unknown[]) => mockGetAuthContext(...args),
  requireCapability: (...args: unknown[]) => mockRequireCapability(...args),
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: mockWithOrgContext,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/schema', () => ({
  calls: { id: 'id', org_id: 'org_id', cost_cents: 'cost_cents', status: 'status' },
}));

vi.mock('@/lib/services/credit', () => ({
  refundCall: mockRefundCall,
}));

vi.mock('@/lib/email', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@/lib/env', () => ({
  env: new Proxy(__testEnv, {
    get: (target, prop) => (target as Record<string, unknown>)[prop as string],
  }),
}));

import { refundCallAction, reportCallIssueAction } from '@/actions/calls';

const VALID_CALL_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mockGetAuthContext.mockClear();
  mockRequireCapability.mockClear();
  mockRefundCall.mockClear();
  mockSendEmail.mockClear();
  mockRecordAudit.mockClear();
  mockWithOrgContext.mockClear();
  mockTx.select.mockClear();
  setSelectResult([]);
  __testEnv.SUPPORT_EMAIL_ADDRESS = 'support@test.example';
});

describe('refundCallAction', () => {
  it('rejects an invalid call id', async () => {
    const result = await refundCallAction({ callId: 'not-a-uuid', reason: 'duplicate billing' });
    expect(result).toEqual({ ok: false, message: 'invalid_call_id' });
    expect(mockRefundCall).not.toHaveBeenCalled();
  });

  it('rejects a too-short reason', async () => {
    const result = await refundCallAction({ callId: VALID_CALL_ID, reason: 'a' });
    expect(result).toEqual({ ok: false, message: 'reason_required' });
  });

  it('returns call_not_found when the call does not exist for this org', async () => {
    setSelectResult([]);
    const result = await refundCallAction({ callId: VALID_CALL_ID, reason: 'system glitch' });
    expect(result).toEqual({ ok: false, message: 'call_not_found' });
    expect(mockRefundCall).not.toHaveBeenCalled();
  });

  it('returns call_not_refundable when the call has zero cost', async () => {
    setSelectResult([{ cost_cents: 0, status: 'failed' }]);
    const result = await refundCallAction({ callId: VALID_CALL_ID, reason: 'no charge' });
    expect(result).toEqual({ ok: false, message: 'call_not_refundable' });
    expect(mockRefundCall).not.toHaveBeenCalled();
  });

  it('refunds the actual cost when the call is valid', async () => {
    setSelectResult([{ cost_cents: 130, status: 'completed' }]);
    const result = await refundCallAction({ callId: VALID_CALL_ID, reason: 'wrong number' });
    expect(result).toEqual({ ok: true });
    expect(mockRequireCapability).toHaveBeenCalledWith('billing.topup');
    expect(mockRefundCall).toHaveBeenCalledWith('org-1', VALID_CALL_ID, 130, 'wrong number');
  });
});

describe('reportCallIssueAction', () => {
  it('rejects when the message is too short', async () => {
    const result = await reportCallIssueAction({ callId: VALID_CALL_ID, message: 'a' });
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toBe('message_required');
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns call_not_found when the call is not visible to the caller', async () => {
    setSelectResult([]);
    const result = await reportCallIssueAction({
      callId: VALID_CALL_ID,
      message: 'audio cuts out',
    });
    expect(result).toEqual({ ok: false, message: 'call_not_found' });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('records the report and sends an email when configured', async () => {
    setSelectResult([{ id: VALID_CALL_ID }]);
    const result = await reportCallIssueAction({
      callId: VALID_CALL_ID,
      message: 'audio cuts out',
    });
    expect(result).toEqual({ ok: true });
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const sent = mockSendEmail.mock.calls[0]?.[0] as Record<string, string>;
    expect(sent.to).toBe('support@test.example');
    expect(sent.subject).toContain(VALID_CALL_ID);
    expect(sent.text).toContain('audio cuts out');
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({
      action: 'call.issue_reported',
      subjectType: 'call',
      subjectId: VALID_CALL_ID,
      metadata: expect.objectContaining({ deliveredEmail: true }),
    });
  });

  it('escapes HTML in the user-supplied message', async () => {
    setSelectResult([{ id: VALID_CALL_ID }]);
    await reportCallIssueAction({
      callId: VALID_CALL_ID,
      message: '<script>alert(1)</script>',
    });
    const sent = mockSendEmail.mock.calls[0]?.[0] as Record<string, string>;
    expect(sent.html).toContain('&lt;script&gt;');
    expect(sent.html).not.toContain('<script>alert(1)</script>');
  });

  it('returns support_email_not_configured when SUPPORT_EMAIL_ADDRESS is missing, but still audits', async () => {
    __testEnv.SUPPORT_EMAIL_ADDRESS = undefined;
    setSelectResult([{ id: VALID_CALL_ID }]);
    const result = await reportCallIssueAction({
      callId: VALID_CALL_ID,
      message: 'audio cuts out',
    });
    expect(result).toEqual({ ok: false, message: 'support_email_not_configured' });
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0]?.[1]).toMatchObject({
      action: 'call.issue_reported',
      metadata: expect.objectContaining({ deliveredEmail: false }),
    });
  });
});
