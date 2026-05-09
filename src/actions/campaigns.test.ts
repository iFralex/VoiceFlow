import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAuthContext,
  mockRequireCapability,
  mockSendInngestEvent,
  mockRecordAudit,
  mockWithOrgContext,
  mockCollectExport,
  mockToCsv,
  mockStorageUpload,
  mockCreateSignedUrl,
} = vi.hoisted(() => ({
  mockGetAuthContext: vi.fn(),
  mockRequireCapability: vi.fn(),
  mockSendInngestEvent: vi.fn(),
  mockRecordAudit: vi.fn(),
  mockWithOrgContext: vi.fn(),
  mockCollectExport: vi.fn(),
  mockToCsv: vi.fn(),
  mockStorageUpload: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: mockGetAuthContext,
  requireCapability: mockRequireCapability,
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: mockSendInngestEvent,
}));

vi.mock('@/lib/db/audit', () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock('@/lib/db/context', () => ({
  withOrgContext: (...args: unknown[]) => mockWithOrgContext(...args),
}));

vi.mock('@/lib/services/campaign-results', () => ({
  collectCampaignResultsForExport: mockCollectExport,
  campaignResultsToCsv: mockToCsv,
}));

// The campaign-lifecycle services are imported by the module under test; stub
// them so the import doesn't pull in real DB code.
vi.mock('@/lib/services/campaigns', () => ({
  cancelCampaign: vi.fn(),
  createCampaign: vi.fn(),
  duplicateCampaign: vi.fn(),
  launchCampaign: vi.fn(),
  pauseCampaign: vi.fn(),
  resumeCampaign: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        upload: mockStorageUpload,
        createSignedUrl: mockCreateSignedUrl,
      }),
    },
  },
}));

import { exportCampaignResults } from './campaigns';

const ORG_ID = 'eeeeeeee-ffff-4000-8000-000000000001';
const USER_ID = '11111111-2222-4333-8444-555555555555';
const CAMPAIGN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';

function makeRow(id: string) {
  return {
    id,
    contactId: `contact-${id}`,
    contactName: `Mario ${id}`,
    phoneE164: '+393331234567',
    status: 'completed' as const,
    outcome: 'appointment_booked' as const,
    billableSeconds: 90,
    costCents: 75,
    startedAtIso: '2026-05-09T10:00:00.000Z',
    endedAtIso: '2026-05-09T10:01:30.000Z',
    createdAtIso: '2026-05-09T09:59:00.000Z',
    appointmentScheduledAtIso: '2026-05-15T14:00:00.000Z',
  };
}

describe('exportCampaignResults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthContext.mockResolvedValue({ orgId: ORG_ID, userId: USER_ID, role: 'operator' });
    mockRequireCapability.mockResolvedValue(undefined);
    mockSendInngestEvent.mockResolvedValue(undefined);
    mockRecordAudit.mockResolvedValue(undefined);
    mockWithOrgContext.mockImplementation(
      async (_orgId: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
    mockCollectExport.mockResolvedValue({
      rows: [makeRow('call-1'), makeRow('call-2')],
      total: 2,
    });
    mockToCsv.mockReturnValue('contatto,telefono\nMario call-1,+393331234567');
    mockStorageUpload.mockResolvedValue({ data: {}, error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://example.com/export.csv' },
      error: null,
    });
  });

  it('returns a signed URL and row count when ≤ inline limit', async () => {
    const result = await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://example.com/export.csv');
    expect(result.rowCount).toBe(2);
    expect(result.exportId).toBeDefined();
    expect(result.deferred).toBeUndefined();
  });

  it('uploads CSV to <orgId>/exports/campaign-<id>-<timestamp>.csv', async () => {
    await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^${ORG_ID}/exports/campaign-${CAMPAIGN_ID}-.*\\.csv$`),
      ),
      'contatto,telefono\nMario call-1,+393331234567',
      expect.objectContaining({ contentType: 'text/csv' }),
    );
  });

  it('signs the download URL with a 1-hour TTL', async () => {
    await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      expect.any(String),
      3_600,
    );
  });

  it('records an audit log entry on inline completion', async () => {
    await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: ORG_ID,
        actorUserId: USER_ID,
        actorType: 'user',
        action: 'campaign.export_completed',
        subjectType: 'campaign',
        subjectId: CAMPAIGN_ID,
        metadata: expect.objectContaining({ rowCount: 2 }),
      }),
    );
  });

  it('defers to Inngest when total exceeds the inline limit', async () => {
    mockCollectExport.mockResolvedValue({
      rows: [makeRow('call-1')],
      total: 6_000,
    });

    const result = await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(result.ok).toBe(true);
    expect(result.deferred).toBe(true);
    expect(result.exportId).toBeDefined();
    expect(result.url).toBeUndefined();
    expect(mockSendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'campaign/export-requested',
        data: expect.objectContaining({
          orgId: ORG_ID,
          campaignId: CAMPAIGN_ID,
          requestedByUserId: USER_ID,
        }),
      }),
    );
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('records an audit entry for deferred exports too', async () => {
    mockCollectExport.mockResolvedValue({
      rows: [],
      total: 6_000,
    });

    await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        action: 'campaign.export_requested',
        metadata: expect.objectContaining({ deferred: true, total: 6_000 }),
      }),
    );
  });

  it('forwards filters to the export collector', async () => {
    await exportCampaignResults({
      campaignId: CAMPAIGN_ID,
      outcomes: ['appointment_booked', 'interested'],
      durationMinSeconds: 30,
      durationMaxSeconds: 600,
      startedAfter: '2026-05-01T00:00:00.000Z',
      startedBefore: '2026-05-09T23:59:59.000Z',
    });

    expect(mockCollectExport).toHaveBeenCalledWith(
      ORG_ID,
      CAMPAIGN_ID,
      expect.objectContaining({
        outcomes: ['appointment_booked', 'interested'],
        durationMinSeconds: 30,
        durationMaxSeconds: 600,
        startedAfter: new Date('2026-05-01T00:00:00.000Z'),
        startedBefore: new Date('2026-05-09T23:59:59.000Z'),
      }),
      5_000,
    );
  });

  it('forwards selected callIds when provided', async () => {
    const callIds = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ];

    await exportCampaignResults({ campaignId: CAMPAIGN_ID, callIds });

    expect(mockCollectExport).toHaveBeenCalledWith(
      ORG_ID,
      CAMPAIGN_ID,
      expect.objectContaining({ callIds }),
      5_000,
    );
  });

  it('rejects when campaignId is not a UUID', async () => {
    const result = await exportCampaignResults({ campaignId: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    expect(mockCollectExport).not.toHaveBeenCalled();
  });

  it('returns error when upload fails', async () => {
    mockStorageUpload.mockResolvedValue({
      data: null,
      error: { message: 'storage error' },
    });

    const result = await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.message).toBe('export_upload_failed');
  });

  it('returns error when signing the URL fails', async () => {
    mockCreateSignedUrl.mockResolvedValue({
      data: null,
      error: { message: 'sign error' },
    });

    const result = await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.message).toBe('export_sign_failed');
  });

  it('returns error when the calling role lacks campaigns.view', async () => {
    mockRequireCapability.mockRejectedValueOnce(
      new Error("Forbidden: role 'viewer' does not have capability 'campaigns.view'"),
    );

    const result = await exportCampaignResults({ campaignId: CAMPAIGN_ID });

    expect(result.ok).toBe(false);
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
