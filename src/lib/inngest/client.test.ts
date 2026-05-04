import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: {
    INNGEST_EVENT_KEY: 'test-event-key',
    INNGEST_SIGNING_KEY: 'test-signing-key',
    CREDIT_SOFT_THRESHOLD_MINUTES: 30,
    CREDIT_HARD_THRESHOLD_CENTS: 0,
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('sendInngestEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['INNGEST_BASE_URL'];
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  });

  it('POSTs to inn.gs with the event key by default', async () => {
    const { sendInngestEvent } = await import('./client');

    await sendInngestEvent({ name: 'credit/low-balance', data: { orgId: 'org-1', balanceCents: 10 } });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://inn.gs/e/test-event-key');
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('includes name and data in the JSON body', async () => {
    const { sendInngestEvent } = await import('./client');

    await sendInngestEvent({
      name: 'credit/low-balance',
      data: { orgId: 'org-1', balanceCents: 10, remainingMinutes: 2 },
    });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as unknown[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      name: 'credit/low-balance',
      data: { orgId: 'org-1', balanceCents: 10, remainingMinutes: 2 },
    });
  });

  it('includes id in the body when provided', async () => {
    const { sendInngestEvent } = await import('./client');

    await sendInngestEvent({ name: 'credit/low-balance', data: {}, id: 'my-event-id' });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as { id?: string }[];
    expect(body[0]?.id).toBe('my-event-id');
  });

  it('uses INNGEST_BASE_URL when set', async () => {
    process.env['INNGEST_BASE_URL'] = 'http://localhost:8288';
    const { sendInngestEvent } = await import('./client');

    await sendInngestEvent({ name: 'test/event', data: {} });

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8288/e/test-event-key');
  });

  it('throws when the response status is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const { sendInngestEvent } = await import('./client');

    await expect(
      sendInngestEvent({ name: 'credit/low-balance', data: {} }),
    ).rejects.toThrow('Inngest event send failed: 500 Internal Server Error');
  });

  it('propagates fetch errors (e.g. network unavailable)', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { sendInngestEvent } = await import('./client');

    await expect(sendInngestEvent({ name: 'credit/low-balance', data: {} })).rejects.toThrow(
      'Network error',
    );
  });
});
