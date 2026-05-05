// Stub — full implementation in Task 5
import type { VoiceProvider, CreateCallParams, TranscriptSegment } from '../types';

export class RetellAdapter implements VoiceProvider {
  name = 'retell' as const;

  constructor(private apiKey: string) {}

  async createCall(_params: CreateCallParams): Promise<{ providerCallId: string }> {
    throw new Error('RetellAdapter.createCall not yet implemented');
  }

  async cancelCall(_providerCallId: string): Promise<void> {
    throw new Error('RetellAdapter.cancelCall not yet implemented');
  }

  async fetchRecording(_providerCallId: string): Promise<{ url: string; bytes: Buffer | null }> {
    throw new Error('RetellAdapter.fetchRecording not yet implemented');
  }

  async fetchTranscript(_providerCallId: string): Promise<TranscriptSegment[]> {
    throw new Error('RetellAdapter.fetchTranscript not yet implemented');
  }
}
