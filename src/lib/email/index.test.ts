import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM_ADDRESS: 'noreply@example.com',
    EMAIL_REPLY_TO: undefined as string | undefined,
  },
}));

vi.mock('@/lib/env', () => ({
  get env() {
    return mockEnv;
  },
}));

import { sendEmail } from './index';

describe('sendEmail', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.RESEND_API_KEY = 're_test';
    mockEnv.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    mockEnv.EMAIL_REPLY_TO = undefined;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs to Resend with the expected headers and body', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'hello',
      html: '<p>hi</p>',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(opts.method).toBe('POST');
    const headers = opts.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer re_test');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'hello',
      html: '<p>hi</p>',
    });
    expect(body['reply_to']).toBeUndefined();
  });

  it('includes reply_to when EMAIL_REPLY_TO is set', async () => {
    mockEnv.EMAIL_REPLY_TO = 'support@example.com';
    await sendEmail({ to: 'user@example.com', subject: 'hi', html: '<p>x</p>' });
    const opts = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(body['reply_to']).toBe('support@example.com');
  });

  it('throws when Resend returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"error":"bad"}', { status: 422, statusText: 'Unprocessable Entity' }),
    );
    await expect(
      sendEmail({ to: 'user@example.com', subject: 's', html: 'h' }),
    ).rejects.toThrow(/Resend send failed/);
  });

  it('no-ops without throwing when API key is missing', async () => {
    mockEnv.RESEND_API_KEY = '';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail({ to: 'user@example.com', subject: 's', html: 'h' });
    expect(fetchSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
