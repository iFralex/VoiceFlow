import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { persistCallArtifacts, RecordingNotReadyError, CALL_MEDIA_BUCKET } from './persistence';

vi.mock('@/lib/db/context', () => ({
  withSystemContext: vi.fn(),
  withOrgContext: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn(),
    },
  },
}));

vi.mock('@/lib/voice/factory', () => ({
  getVoiceProviderByName: vi.fn(),
}));

import { withSystemContext, withOrgContext } from '@/lib/db/context';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getVoiceProviderByName } from '@/lib/voice/factory';

const CALL_ID = 'call-uuid-123';
const ORG_ID = 'org-uuid-456';
const PROVIDER_CALL_ID = 'vapi-call-789';
const RECORDING_BYTES = Buffer.from('fake-mp3-bytes');
const RECORDING_URL = 'https://cdn.vapi.ai/recordings/xyz.mp3';
const TRANSCRIPT_SEGMENTS = [
  { speaker: 'agent', text: 'Ciao, sono un assistente.', startMs: 0, endMs: 2000 },
  { speaker: 'caller', text: 'Ciao, si.', startMs: 2500, endMs: 4000 },
];

function makeCallRow(overrides: Partial<{ provider: string; provider_call_id: string | null }> = {}) {
  return { org_id: ORG_ID, provider: 'vapi', provider_call_id: PROVIDER_CALL_ID, ...overrides };
}

function makeStorageMock(uploadError: Error | null = null) {
  return { upload: vi.fn().mockResolvedValue({ error: uploadError }) };
}

function makeAdapterInstance(bytes: Buffer | null = RECORDING_BYTES) {
  return {
    fetchRecording: vi.fn().mockResolvedValue({ url: RECORDING_URL, bytes }),
    fetchTranscript: vi.fn().mockResolvedValue(TRANSCRIPT_SEGMENTS),
  };
}

describe('persistCallArtifacts', () => {
  beforeEach(() => {
    vi.stubEnv('SKIP_ENV_VALIDATION', 'true');
    vi.stubEnv('VAPI_API_KEY', 'test-vapi-key');
    vi.stubEnv('RETELL_API_KEY', 'test-retell-key');

    vi.mocked(withSystemContext).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([makeCallRow()]),
      };
      return fn(tx as never);
    });

    vi.mocked(withOrgContext).mockImplementation(async (_orgId, fn) => {
      const tx = {
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };
      return fn(tx as never);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('fetches recording and transcript, uploads both, updates call record', async () => {
    const instance = makeAdapterInstance();
    vi.mocked(getVoiceProviderByName).mockReturnValue(instance as never);
    const storageMock = makeStorageMock();
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storageMock as never);

    await persistCallArtifacts(CALL_ID);

    expect(getVoiceProviderByName).toHaveBeenCalledWith('vapi');
    expect(instance.fetchRecording).toHaveBeenCalledWith(PROVIDER_CALL_ID);
    expect(instance.fetchTranscript).toHaveBeenCalledWith(PROVIDER_CALL_ID);
    expect(supabaseAdmin.storage.from).toHaveBeenCalledWith(CALL_MEDIA_BUCKET);
    expect(storageMock.upload).toHaveBeenCalledTimes(2);

    const uploadCalls = storageMock.upload.mock.calls as [string, unknown, Record<string, unknown>][];
    const [recPath, recBody, recOpts] = uploadCalls[0]!;
    const [txPath, txBody, txOpts] = uploadCalls[1]!;
    expect(recPath).toBe(`recordings/${ORG_ID}/${CALL_ID}.mp3`);
    expect(recBody).toEqual(RECORDING_BYTES);
    expect(recOpts).toMatchObject({ contentType: 'audio/mpeg', upsert: true });
    expect(txPath).toBe(`transcripts/${ORG_ID}/${CALL_ID}.json`);
    expect(Buffer.isBuffer(txBody)).toBe(true);
    expect(JSON.parse((txBody as Buffer).toString('utf-8'))).toEqual(TRANSCRIPT_SEGMENTS);
    expect(txOpts).toMatchObject({ contentType: 'application/json', upsert: true });
    expect(withOrgContext).toHaveBeenCalledWith(ORG_ID, expect.any(Function));
  });

  it('throws RecordingNotReadyError when bytes are null', async () => {
    vi.mocked(getVoiceProviderByName).mockReturnValue(makeAdapterInstance(null) as never);
    const storageMock = makeStorageMock();
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storageMock as never);

    await expect(persistCallArtifacts(CALL_ID)).rejects.toThrow(RecordingNotReadyError);
    expect(storageMock.upload).not.toHaveBeenCalled();
  });

  it('throws when call is not found', async () => {
    vi.mocked(withSystemContext).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]),
      };
      return fn(tx as never);
    });
    await expect(persistCallArtifacts(CALL_ID)).rejects.toThrow(`Call not found: ${CALL_ID}`);
  });

  it('throws when provider_call_id is null', async () => {
    vi.mocked(withSystemContext).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([makeCallRow({ provider_call_id: null })]),
      };
      return fn(tx as never);
    });
    await expect(persistCallArtifacts(CALL_ID)).rejects.toThrow(`Call ${CALL_ID} has no provider_call_id`);
  });

  it('throws when storage upload fails', async () => {
    vi.mocked(getVoiceProviderByName).mockReturnValue(makeAdapterInstance() as never);
    const storageMock = makeStorageMock(new Error('bucket not found'));
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storageMock as never);
    await expect(persistCallArtifacts(CALL_ID)).rejects.toThrow('Storage upload failed');
  });

  it('delegates to getVoiceProviderByName with retell provider', async () => {
    vi.mocked(withSystemContext).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([makeCallRow({ provider: 'retell' })]),
      };
      return fn(tx as never);
    });
    const instance = makeAdapterInstance();
    vi.mocked(getVoiceProviderByName).mockReturnValue(instance as never);
    const storageMock = makeStorageMock();
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storageMock as never);

    await persistCallArtifacts(CALL_ID);

    expect(getVoiceProviderByName).toHaveBeenCalledWith('retell');
    expect(instance.fetchRecording).toHaveBeenCalledWith(PROVIDER_CALL_ID);
  });

  it('throws when getVoiceProviderByName throws for unknown provider', async () => {
    vi.mocked(getVoiceProviderByName).mockImplementation((p) => {
      throw new Error(`Unknown voice provider: ${p}`);
    });
    vi.mocked(withSystemContext).mockImplementation(async (fn) => {
      const tx = {
        select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([makeCallRow({ provider: 'proprietary' })]),
      };
      return fn(tx as never);
    });
    await expect(persistCallArtifacts(CALL_ID)).rejects.toThrow('Unknown voice provider');
  });
});
