import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/voice/classifier', () => ({
  classifyTranscript: vi.fn(),
}));

vi.mock('@/lib/voice/disclosure', () => ({
  checkDisclosure: vi.fn(),
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

import { sendInngestEvent } from '@/lib/inngest/client';
import { classifyTranscript } from '@/lib/voice/classifier';
import { checkDisclosure } from '@/lib/voice/disclosure';

import { classifyCallHandler } from './classify';
import { QUALITY_DISCLOSURE_MISSING_EVENT, QUALITY_OUTCOME_MISMATCH_EVENT } from './events';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CALL_ID = 'call-uuid-classify-test';
const ORG_ID = 'org-uuid-classify-test';

const BASE_DATA = { callId: CALL_ID, orgId: ORG_ID };

// Segments include the AI Act disclosure phrase so tests that check for
// no-disclosure-event still pass by default (checkDisclosure is mocked).
const SEGMENTS = [
  { speaker: 'agent', text: 'Sono un assistente vocale automatico della concessionaria.', startMs: 0, endMs: 3000 },
  { speaker: 'caller', text: 'Non sono interessato.', startMs: 3100, endMs: 4000 },
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

beforeEach(() => {
  // Default: disclosure is present — existing tests are unaffected by Task 12.
  vi.mocked(checkDisclosure).mockReturnValue(true);
  mockUpdate.mockReturnValue(updateChain);
});

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

  it('skips classifier when tool outcome already set on first read', async () => {
    // First select: call already has a tool-driven outcome
    // Disclosure check still runs (regulatory requirement), but classifier is skipped.
    mockSelect.mockReturnValueOnce(
      makeSelectChain([{ outcome: 'appointment_booked', transcript_path: `transcripts/${ORG_ID}/${CALL_ID}.json` }]),
    );

    mockDownload.mockResolvedValue({
      data: makeTranscriptBlob(SEGMENTS),
      error: null,
    });

    await classifyCallHandler(BASE_DATA);

    // Classifier must not run when outcome is already set
    expect(classifyTranscript).not.toHaveBeenCalled();
    // Outcome columns must not be updated
    expect(updateChain.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: expect.any(String) }),
    );
    // No disclosure-missing event (checkDisclosure returns true by default in beforeEach)
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

    // Must not overwrite the tool-driven outcome (disclosure metadata update is allowed)
    expect(updateChain.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: expect.any(String) }),
    );
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
    // Must not update the call's outcome (disclosure metadata update is allowed)
    expect(updateChain.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: expect.any(String) }),
    );
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

    expect(updateChain.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: expect.any(String) }),
    );
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

  // ─── Task 12: AI disclosure verification ──────────────────────────────────

  describe('disclosure verification', () => {
    it('updates metadata and emits disclosure-missing when phrase absent', async () => {
      vi.mocked(checkDisclosure).mockReturnValue(false);

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
        confidence: 0.88,
        reasoning: 'No interest.',
      });

      vi.mocked(sendInngestEvent).mockResolvedValue(undefined);

      await classifyCallHandler(BASE_DATA);

      // metadata update must have been called with a SQL merge expression
      // (not a plain object, to avoid overwriting existing metadata keys)
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.anything() }),
      );

      // disclosure-missing event must have been emitted
      expect(sendInngestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: QUALITY_DISCLOSURE_MISSING_EVENT,
          data: { callId: CALL_ID, orgId: ORG_ID },
          id: `disclosure-missing-${CALL_ID}`,
        }),
      );
    });

    it('does not update metadata or emit event when phrase is present', async () => {
      vi.mocked(checkDisclosure).mockReturnValue(true);

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
        outcome: 'interested',
        confidence: 0.9,
        reasoning: 'Interest shown.',
      });

      await classifyCallHandler(BASE_DATA);

      // disclosure_verified=true is written to metadata — no disclosure-missing event
      expect(sendInngestEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: QUALITY_DISCLOSURE_MISSING_EVENT }),
      );
    });

    it('still emits disclosure-missing even when a tool outcome is already set', async () => {
      // Tool outcome was set concurrently — handler would normally return early
      // after the mismatch check, but the disclosure check runs before that.
      vi.mocked(checkDisclosure).mockReturnValue(false);

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
        confidence: 0.7,
        reasoning: 'Disagrees.',
      });

      vi.mocked(sendInngestEvent).mockResolvedValue(undefined);

      await classifyCallHandler(BASE_DATA);

      // Disclosure event must still be emitted
      expect(sendInngestEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: QUALITY_DISCLOSURE_MISSING_EVENT }),
      );
    });

    it('passes the parsed transcript segments to checkDisclosure', async () => {
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
        confidence: 0.8,
        reasoning: 'Test.',
      });

      await classifyCallHandler(BASE_DATA);

      expect(checkDisclosure).toHaveBeenCalledWith(SEGMENTS);
    });
  });
});
