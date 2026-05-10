import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmailsSend, mockDbInsert, mockInsertValues, mockEnv } = vi.hoisted(() => {
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockDbInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockEmailsSend = vi.fn();
  const mockEnv = {
    RESEND_API_KEY: 're_test',
    EMAIL_FROM_ADDRESS: 'noreply@example.com',
    EMAIL_REPLY_TO: undefined as string | undefined,
  };
  return { mockEmailsSend, mockDbInsert, mockInsertValues, mockEnv };
});

vi.mock('@/lib/email/client', () => ({
  getResendClient: () => ({
    emails: { send: mockEmailsSend },
  }),
}));

vi.mock('@/lib/db/client', () => ({
  db: { insert: mockDbInsert },
}));

vi.mock('@/lib/db/schema/email_log', () => ({
  emailLog: 'email_log_table',
}));

vi.mock('@/lib/env', () => ({
  get env() {
    return mockEnv;
  },
}));

import { sendEmail } from './index';

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.RESEND_API_KEY = 're_test';
    mockEnv.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    mockEnv.EMAIL_REPLY_TO = undefined;
    mockEmailsSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null });
    mockInsertValues.mockResolvedValue(undefined);
  });

  it('sends via Resend with the expected params', async () => {
    await sendEmail({
      to: 'user@example.com',
      subject: 'hello',
      html: '<p>hi</p>',
    });

    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    const payload = mockEmailsSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      from: 'noreply@example.com',
      to: 'user@example.com',
      subject: 'hello',
      html: '<p>hi</p>',
    });
    expect(payload['reply_to']).toBeUndefined();
  });

  it('includes reply_to when EMAIL_REPLY_TO is set', async () => {
    mockEnv.EMAIL_REPLY_TO = 'support@example.com';
    await sendEmail({ to: 'user@example.com', subject: 'hi', html: '<p>x</p>' });
    const payload = mockEmailsSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['reply_to']).toBe('support@example.com');
  });

  it('passes tags to Resend when provided', async () => {
    const tags = [{ name: 'template', value: 'appointment-booked' }];
    await sendEmail({ to: 'user@example.com', subject: 'hi', html: '<p>x</p>', tags });
    const payload = mockEmailsSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload['tags']).toEqual(tags);
  });

  it('throws when Resend returns an error', async () => {
    mockEmailsSend.mockResolvedValue({
      data: null,
      error: { message: 'bad request', name: 'validation_error', statusCode: 422 },
    });
    await expect(
      sendEmail({ to: 'user@example.com', subject: 's', html: 'h' }),
    ).rejects.toThrow(/Resend send failed/);
  });

  it('no-ops without throwing when API key is missing', async () => {
    mockEnv.RESEND_API_KEY = '';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail({ to: 'user@example.com', subject: 's', html: 'h' });
    expect(mockEmailsSend).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('logs to email_log on success', async () => {
    await sendEmail({ to: 'user@example.com', subject: 'hello', html: '<p>hi</p>' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockDbInsert).toHaveBeenCalledWith('email_log_table');
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        to_address: 'user@example.com',
        subject: 'hello',
        resend_id: 'msg_123',
        error: null,
      }),
    );
  });
});
