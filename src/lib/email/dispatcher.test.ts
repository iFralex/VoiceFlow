import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all external dependencies before importing the dispatcher
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/email/idempotency', () => ({
  hasRecentEmailSent: vi.fn().mockResolvedValue(false),
  hasRecentEmailSentForRef: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/lib/services/credit', () => ({
  getBalance: vi.fn().mockResolvedValue({ balanceCents: 5000, remainingMinutes: 50 }),
}));

vi.mock('@/lib/services/weekly-summary', () => ({
  buildWeeklySummaryData: vi.fn().mockResolvedValue({
    orgId: 'org-1',
    orgName: 'Test Org',
    weekStart: new Date('2025-01-06'),
    weekEnd: new Date('2025-01-12T23:59:59.999Z'),
    totalCalls: 100,
    completedCalls: 80,
    failedCalls: 20,
    qualifiedLeads: 15,
    appointments: 5,
    topCampaigns: [],
    alerts: [],
  }),
  getWeeklySummaryRecipients: vi.fn().mockResolvedValue([
    { userId: 'user-1', email: 'owner@example.com', fullName: 'Owner', locale: 'it' },
  ]),
}));

// Mock DB context to avoid real DB connections
vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((orgId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  withSystemContext: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));

// Mock drizzle operations to return test data
const mockQueryChain = {
  select: vi.fn(),
  from: vi.fn(),
  innerJoin: vi.fn(),
  leftJoin: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
};

// Self-referential chain
Object.keys(mockQueryChain).forEach((key) => {
  (mockQueryChain as Record<string, ReturnType<typeof vi.fn>>)[key].mockReturnValue(mockQueryChain);
});

import { sendEmail } from '@/lib/email';
import { hasRecentEmailSent, hasRecentEmailSentForRef } from '@/lib/email/idempotency';
import {
  sendAppointmentBookedEmail,
  sendCampaignCompletedEmail,
  sendLowBalanceEmail,
  sendMemberInviteEmail,
  sendQualifiedLeadEmail,
  sendSuspiciousLoginEmail,
  sendWeeklySummaryEmail,
} from '@/lib/email/dispatcher';
import { withOrgContext, withSystemContext } from '@/lib/db/context';

describe('email dispatcher — idempotency guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(false);
    vi.mocked(hasRecentEmailSent).mockResolvedValue(false);
  });

  it('sendAppointmentBookedEmail skips when ref already sent', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendAppointmentBookedEmail({ orgId: 'org-1', appointmentId: 'appt-1' });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(withOrgContext).not.toHaveBeenCalled();
  });

  it('sendQualifiedLeadEmail skips when ref already sent', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendQualifiedLeadEmail({ orgId: 'org-1', callId: 'call-1' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sendCampaignCompletedEmail skips when ref already sent', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendCampaignCompletedEmail({ orgId: 'org-1', campaignId: 'camp-1' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sendLowBalanceEmail skips when already sent within 24h', async () => {
    vi.mocked(hasRecentEmailSent).mockResolvedValue(true);
    await sendLowBalanceEmail({ orgId: 'org-1' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sendAppointmentBookedEmail checks idempotency with correct key', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendAppointmentBookedEmail({ orgId: 'org-1', appointmentId: 'appt-42' });
    expect(hasRecentEmailSentForRef).toHaveBeenCalledWith('appointment-booked', 'appt-42', 1);
  });

  it('sendQualifiedLeadEmail checks idempotency with correct key', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendQualifiedLeadEmail({ orgId: 'org-1', callId: 'call-99' });
    expect(hasRecentEmailSentForRef).toHaveBeenCalledWith('qualified-lead', 'call-99', 1);
  });

  it('sendCampaignCompletedEmail checks idempotency with correct key', async () => {
    vi.mocked(hasRecentEmailSentForRef).mockResolvedValue(true);
    await sendCampaignCompletedEmail({ orgId: 'org-1', campaignId: 'camp-77' });
    expect(hasRecentEmailSentForRef).toHaveBeenCalledWith('campaign-completed', 'camp-77', 1);
  });

  it('sendLowBalanceEmail checks idempotency with 24h window', async () => {
    vi.mocked(hasRecentEmailSent).mockResolvedValue(true);
    await sendLowBalanceEmail({ orgId: 'org-55' });
    expect(hasRecentEmailSent).toHaveBeenCalledWith('org-55', 'low-balance', 24);
  });
});

describe('email dispatcher — weekly summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sendWeeklySummaryEmail returns without sending when no recipients', async () => {
    const { getWeeklySummaryRecipients } = await import('@/lib/services/weekly-summary');
    vi.mocked(getWeeklySummaryRecipients).mockResolvedValue([]);

    const orgTx = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ name: 'Test Org' }]),
    };
    vi.mocked(withSystemContext).mockImplementationOnce((fn) => fn(orgTx as never));

    await sendWeeklySummaryEmail({ orgId: 'org-1', weekStart: new Date('2025-01-06') });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
