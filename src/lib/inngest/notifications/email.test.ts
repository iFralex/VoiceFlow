import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email/dispatcher', () => ({
  sendAppointmentBookedEmail: vi.fn(),
  sendCampaignCompletedEmail: vi.fn(),
  sendLowBalanceEmail: vi.fn(),
  sendQualifiedLeadEmail: vi.fn(),
  sendSuspiciousLoginEmail: vi.fn(),
}));

import {
  sendAppointmentBookedEmail,
  sendCampaignCompletedEmail,
  sendLowBalanceEmail,
  sendQualifiedLeadEmail,
  sendSuspiciousLoginEmail,
} from '@/lib/email/dispatcher';

import {
  appointmentBookedEmailHandler,
  campaignCompletedEmailHandler,
  lowBalanceEmailHandler,
  qualifiedLeadEmailHandler,
  suspiciousLoginEmailHandler,
} from './email';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('appointmentBookedEmailHandler', () => {
  it('delegates to sendAppointmentBookedEmail with orgId and appointmentId', async () => {
    vi.mocked(sendAppointmentBookedEmail).mockResolvedValue(undefined);

    await appointmentBookedEmailHandler({
      callId: 'call-1',
      orgId: 'org-1',
      appointmentId: 'appt-1',
    });

    expect(sendAppointmentBookedEmail).toHaveBeenCalledOnce();
    expect(sendAppointmentBookedEmail).toHaveBeenCalledWith({
      orgId: 'org-1',
      appointmentId: 'appt-1',
    });
  });

  it('propagates errors from the dispatcher', async () => {
    vi.mocked(sendAppointmentBookedEmail).mockRejectedValue(new Error('resend error'));

    await expect(
      appointmentBookedEmailHandler({ callId: 'c', orgId: 'o', appointmentId: 'a' }),
    ).rejects.toThrow('resend error');
  });
});

describe('qualifiedLeadEmailHandler', () => {
  it('delegates to sendQualifiedLeadEmail with orgId and callId', async () => {
    vi.mocked(sendQualifiedLeadEmail).mockResolvedValue(undefined);

    await qualifiedLeadEmailHandler({ callId: 'call-42', orgId: 'org-2' });

    expect(sendQualifiedLeadEmail).toHaveBeenCalledOnce();
    expect(sendQualifiedLeadEmail).toHaveBeenCalledWith({ orgId: 'org-2', callId: 'call-42' });
  });

  it('propagates errors from the dispatcher', async () => {
    vi.mocked(sendQualifiedLeadEmail).mockRejectedValue(new Error('timeout'));

    await expect(qualifiedLeadEmailHandler({ callId: 'c', orgId: 'o' })).rejects.toThrow(
      'timeout',
    );
  });
});

describe('lowBalanceEmailHandler', () => {
  it('delegates to sendLowBalanceEmail with orgId', async () => {
    vi.mocked(sendLowBalanceEmail).mockResolvedValue(undefined);

    await lowBalanceEmailHandler({ orgId: 'org-3', balanceCents: 500, remainingMinutes: 10 });

    expect(sendLowBalanceEmail).toHaveBeenCalledOnce();
    expect(sendLowBalanceEmail).toHaveBeenCalledWith({ orgId: 'org-3' });
  });

  it('propagates errors from the dispatcher', async () => {
    vi.mocked(sendLowBalanceEmail).mockRejectedValue(new Error('db error'));

    await expect(
      lowBalanceEmailHandler({ orgId: 'o', balanceCents: 0, remainingMinutes: 0 }),
    ).rejects.toThrow('db error');
  });
});

describe('campaignCompletedEmailHandler', () => {
  it('delegates to sendCampaignCompletedEmail with orgId and campaignId', async () => {
    vi.mocked(sendCampaignCompletedEmail).mockResolvedValue(undefined);

    await campaignCompletedEmailHandler({ orgId: 'org-4', campaignId: 'camp-5' });

    expect(sendCampaignCompletedEmail).toHaveBeenCalledOnce();
    expect(sendCampaignCompletedEmail).toHaveBeenCalledWith({
      orgId: 'org-4',
      campaignId: 'camp-5',
    });
  });

  it('propagates errors from the dispatcher', async () => {
    vi.mocked(sendCampaignCompletedEmail).mockRejectedValue(new Error('resend down'));

    await expect(
      campaignCompletedEmailHandler({ orgId: 'o', campaignId: 'c' }),
    ).rejects.toThrow('resend down');
  });
});

describe('suspiciousLoginEmailHandler', () => {
  it('delegates to sendSuspiciousLoginEmail with userId and signinId', async () => {
    vi.mocked(sendSuspiciousLoginEmail).mockResolvedValue(undefined);

    await suspiciousLoginEmailHandler({ userId: 'user-1', signinId: 'signin-9' });

    expect(sendSuspiciousLoginEmail).toHaveBeenCalledOnce();
    expect(sendSuspiciousLoginEmail).toHaveBeenCalledWith({
      userId: 'user-1',
      signinId: 'signin-9',
    });
  });

  it('propagates errors from the dispatcher', async () => {
    vi.mocked(sendSuspiciousLoginEmail).mockRejectedValue(new Error('send failed'));

    await expect(
      suspiciousLoginEmailHandler({ userId: 'u', signinId: 's' }),
    ).rejects.toThrow('send failed');
  });
});
