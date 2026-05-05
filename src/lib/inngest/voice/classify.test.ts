import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/voice/classifier', () => ({
  classifyTranscript: vi.fn(),
}));

vi.mock('@/lib/inngest/client', () => ({
  sendInngestEvent: vi.fn(),
}));

vi.mock('@/lib/voice/persistence', () => ({
  CALL_MEDIA_BUCKET: 'call-media',
  persistCallArtifacts: vi.fn(),
  RecordingNotReadyError: class RecordingNotReadyError extends Error {},
}));

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockTxChain: Record<string, unknown> = {};

vi.mock('@/lib/db/context', () => ({
  withOrgContext: vi.fn((_orgId: string, fn: (tx: unknown) => unknown) => fn(mockTxChain)),
  withSystemContext: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTxChain)),
}));

const mockDownload = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(() => ({ download: mockDownload })),
    },
  },
}));

// ─── Set up mock tx ────────────────────────────────────────────────────────

const updateSetChain = { where: vi.fn(() => Promise.resolve()) };
const updateChain = { set: vi.fn(() => updateSetChain) };

mockTxChain.select = mockSelect;
mockTxChain.update = mockUpdate;
mockUpdate.mockReturnValue(updateChain);

// ─── Module under test ────────────────────────────────────────────────────────

import { classifyCallHandler } from './classify';
import { classifyTranscript } from '@/lib/voice/classifier';
import { sendInngestEvent } from '@/lib/inngest/client';
import { QUALITY_OUTCOME_MISMATCH_EVENT } from './events';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CALL_ID = 'call-uuid-classify-test';
const ORG_ID = 'org-uuid-classify-test';

const BASE_DATA = { callId: CALL_ID, orgId: ORG_ID };

const SEGMENTS = [
  { speaker: 'agent', text: 'Buongiorno.', startMs: 0, endMs: 1000 },
  { speaker: 'caller', text: 'Non sono interessato.', startMs: 1100, endMs: 2000 },
];

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeTranscriptBlob(segments: unknown[]) {
  return {
    text: async () => JSON.stringify(segments),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
});

describe('classifyCallHandler', () => {
  it('classifies and persists outcome when no tool outcome exists', async () => {
    // First select: call with no outcome, has transcript_path
    // Second select: re-read — still no outcome
    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([{ outcome: null }]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'not_interested',
      confidence: 0.92,
      reasoning: 'Caller declined.',
    });

    await classifyCallHandler(BASE_DATA);

    expect(classifyTranscript).toHaveBeenCalledWith(SEGMENTS);
    expect(mockUpdate).toHaveBeenCalled();
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'not_interested',
        outcome_confidence: '0.92',
      }),
    );
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('does not overwrite tool outcome when outcomes agree', async () => {
    // First select: no outcome yet
    // Second select: tool outcome was set to same value
    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([{ outcome: 'not_interested' }]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'not_interested',
      confidence: 0.88,
      reasoning: 'Caller declined.',
    });

    await classifyCallHandler(BASE_DATA);

    // Must not overwrite since tool outcome already set
    expect(mockUpdate).not.toHaveBeenCalled();
    // No mismatch — no quality event
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('emits quality.outcome-mismatch when tool and inferred outcomes disagree', async () => {
    // First select: no outcome yet
    // Second select: tool outcome appeared concurrently (different from classifier)
    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([{ outcome: 'appointment_booked' }]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'not_interested',
      confidence: 0.75,
      reasoning: 'Caller seemed uninterested.',
    });

    vi.mocked(sendInngestEvent).mockResolvedValue(undefined);

    await classifyCallHandler(BASE_DATA);

    expect(sendInngestEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: QUALITY_OUTCOME_MISMATCH_EVENT,
        data: expect.objectContaining({
          callId: CALL_ID,
          orgId: ORG_ID,
          toolOutcome: 'appointment_booked',
          inferredOutcome: 'not_interested',
          inferredConfidence: 0.75,
        }),
      }),
    );
    // Must not update the call's outcome
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns early when call not found (first select)', async () => {
    mockSelect.mockReturnValueOnce(makeSelectChain([]));

    await classifyCallHandler(BASE_DATA);

    expect(classifyTranscript).not.toHaveBeenCalled();
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('returns early when re-read call not found (second select)', async () => {
    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'interested',
      confidence: 0.8,
      reasoning: 'Interest shown.',
    });

    await classifyCallHandler(BASE_DATA);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(sendInngestEvent).not.toHaveBeenCalled();
  });

  it('throws when transcript_path is missing', async () => {
    mockSelect.mockReturnValueOnce(
      makeSelectChain([{ outcome: null, transcript_path: null }]),
    );

    await expect(classifyCallHandler(BASE_DATA)).rejects.toThrow(
      `Call ${CALL_ID} has no transcript_path`,
    );
  });

  it('throws when storage download fails', async () => {
    mockSelect.mockReturnValueOnce(
      makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
    );

    mockDownload.mockResolvedValue({
      data: null,
      error: { message: 'Object not found' },
    });

    await expect(classifyCallHandler(BASE_DATA)).rejects.toThrow(
      `Failed to download transcript for call ${CALL_ID}`,
    );
  });

  it('passes transcript segments to the classifier', async () => {
    const customSegments = [
      { speaker: 'agent', text: 'Hello', startMs: 0, endMs: 500 },
      { speaker: 'caller', text: 'Yes, interested', startMs: 600, endMs: 1200 },
    ];

    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([{ outcome: null }]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(customSegments),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'interested',
      confidence: 0.85,
      reasoning: 'Interest expressed.',
    });

    await classifyCallHandler(BASE_DATA);

    expect(classifyTranscript).toHaveBeenCalledWith(customSegments);
  });

  it('formats outcome_confidence as 2 decimal places', async () => {
    mockSelect
      .mockReturnValueOnce(
        makeSelectChain([{ outcome: null, transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
      )
      .mockReturnValueOnce(makeSelectChain([{ outcome: null }]));

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    vi.mocked(classifyTranscript).mockResolvedValue({
      outcome: 'callback_requested',
      confidence: 0.9,
      reasoning: 'Callback asked for.',
    });

    await classifyCallHandler(BASE_DATA);

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ outcome_confidence: '0.90' }),
    );
  });
});
