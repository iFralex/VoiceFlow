// Stub — full implementation in Task 4
import type { VoiceProvider, CreateCallParams, TranscriptSegment } from '../types';

export class VapiAdapter implements VoiceProvider {
  name = 'vapi' as const;

  constructor(private apiKey: string) {}

  async createCall(_params: CreateCallParams): Promise<{ providerCallId: string }> {
    throw new Error('VapiAdapter.createCall not yet implemented');
  }

  async cancelCall(_providerCallId: string): Promise<void> {
    throw new Error('VapiAdapter.cancelCall not yet implemented');
  }

  async fetchRecording(_providerCallId: string): Promise<{ url: string; bytes: Buffer | null }> {
    throw new Error('VapiAdapter.fetchRecording not yet implemented');
  }

  async fetchTranscript(_providerCallId: string): Promise<TranscriptSegment[]> {
    throw new Error('VapiAdapter.fetchTranscript not yet implemented');
  }
}
