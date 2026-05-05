import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock classifyAndFinaliseCall so it doesn't attempt DB connections in unit tests
vi.mock('@/lib/services/calls', () => ({
  classifyAndFinaliseCall: vi.fn().mockResolvedValue(undefined),
}));

// Mock the persistence module so we can test the handler in isolation
vi.mock('@/lib/voice/persistence', () => {
  class RecordingNotReadyError extends Error {
    constructor(callId: string) {
      super(`Recording not ready for call ${callId} — will retry`);
      this.name = 'RecordingNotReadyError';
    }
  }
  return {
    persistCallArtifacts: vi.fn(),
    RecordingNotReadyError,
    CALL_MEDIA_BUCKET: 'call-media',
  };
});

import { classifyAndFinaliseCall } from '@/lib/services/calls';
import { persistCallArtifacts, RecordingNotReadyError } from '@/lib/voice/persistence';

import { persistCallArtifactsHandler } from './persist-artifacts';

const CALL_ID = 'call-uuid-handler-test';
const ORG_ID = 'org-uuid-handler-test';

const BASE_DATA = {
  callId: CALL_ID,
  orgId: ORG_ID,
  durationSeconds: 60,
  endedReason: 'completed',
  recordingUrl: null,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('persistCallArtifactsHandler', () => {
  it('resolves when persistCallArtifacts resolves', async () => {
    vi.mocked(persistCallArtifacts).mockResolvedValue(undefined);

    await expect(persistCallArtifactsHandler(BASE_DATA)).resolves.toBeUndefined();

    expect(persistCallArtifacts).toHaveBeenCalledWith(CALL_ID);
    expect(classifyAndFinaliseCall).toHaveBeenCalledWith(CALL_ID);
  });

  it('re-throws RecordingNotReadyError so Inngest retries', async () => {
    const notReadyErr = new RecordingNotReadyError(CALL_ID);
    vi.mocked(persistCallArtifacts).mockRejectedValue(notReadyErr);

    await expect(persistCallArtifactsHandler(BASE_DATA)).rejects.toBeInstanceOf(
      RecordingNotReadyError,
    );
  });

  it('wraps unexpected errors with callId context', async () => {
    vi.mocked(persistCallArtifacts).mockRejectedValue(new Error('DB connection timeout'));

    await expect(persistCallArtifactsHandler(BASE_DATA)).rejects.toThrow(
      `persistCallArtifacts failed for callId=${CALL_ID}`,
    );
  });

  it('wraps non-Error rejections', async () => {
    vi.mocked(persistCallArtifacts).mockRejectedValue('string error');

    await expect(persistCallArtifactsHandler(BASE_DATA)).rejects.toThrow(
      `persistCallArtifacts failed for callId=${CALL_ID}: string error`,
    );
  });
});
