import { env } from '@/lib/env';
import type { VoiceProvider, CreateCallParams, TranscriptSegment, ToolDefinition } from '../types';
import { VoiceProviderError } from '../errors';

const RETELL_BASE_URL = 'https://api.retellai.com';

// Retell API response shapes (minimal — only fields we consume)
interface RetellCallResponse {
  call_id: string;
  call_status: string;
  recording_url?: string;
  transcript_object?: RetellTranscriptEntry[];
  transcript?: string;
}

interface RetellTranscriptEntry {
  role: 'agent' | 'user';
  content: string;
  words: Array<{ word: string; start: number; end: number }>;
}

export class RetellAdapter implements VoiceProvider {
  name = 'retell' as const;

  constructor(private readonly apiKey: string) {}

  async createCall(params: CreateCallParams): Promise<{ providerCallId: string }> {
    // Retell uses a pre-configured agent_id; per-call overrides are injected via
    // retell_llm_dynamic_variables (the agent's LLM prompt must reference these vars).
    const body = {
      agent_id: env.RETELL_AGENT_ID,
      from_number: params.fromNumber,
      to_number: params.toNumber,
      retell_llm_dynamic_variables: {
        system_prompt: params.systemPrompt,
        first_message: params.firstMessage,
        voice_id: params.voiceId,
      },
      metadata: params.metadata,
    };

    const res = await fetch(`${RETELL_BASE_URL}/v2/create-phone-call`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new VoiceProviderError('retell.create_call_failed', text);
    }

    const json = (await res.json()) as RetellCallResponse;
    return { providerCallId: json.call_id };
  }

  async cancelCall(providerCallId: string): Promise<void> {
    const res = await fetch(
      `${RETELL_BASE_URL}/v2/delete-call/${encodeURIComponent(providerCallId)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    // 404 means already gone — treat as success for idempotency
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new VoiceProviderError('retell.cancel_call_failed', text);
    }
  }

  async fetchRecording(providerCallId: string): Promise<{ url: string; bytes: Buffer | null }> {
    const call = await this.fetchCall(providerCallId);

    if (!call.recording_url) {
      throw new VoiceProviderError(
        'retell.recording_not_available',
        `No recording URL for call ${providerCallId}`,
      );
    }

    // Attempt to download the bytes; return null if still processing
    let bytes: Buffer | null = null;
    try {
      const dlRes = await fetch(call.recording_url);
      if (dlRes.ok) {
        const arrayBuffer = await dlRes.arrayBuffer();
        bytes = Buffer.from(arrayBuffer);
      }
    } catch {
      // bytes stays null — caller can retry
    }

    return { url: call.recording_url, bytes };
  }

  async fetchTranscript(providerCallId: string): Promise<TranscriptSegment[]> {
    const call = await this.fetchCall(providerCallId);

    const entries = call.transcript_object ?? [];

    return entries.map((entry): TranscriptSegment => {
      const words = entry.words ?? [];
      const startMs = words.length > 0 ? Math.round(words[0]!.start * 1000) : 0;
      const endMs = words.length > 0 ? Math.round(words[words.length - 1]!.end * 1000) : 0;

      return {
        speaker: entry.role === 'agent' ? 'agent' : 'caller',
        text: entry.content,
        startMs,
        endMs,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchCall(providerCallId: string): Promise<RetellCallResponse> {
    const res = await fetch(
      `${RETELL_BASE_URL}/v2/get-call/${encodeURIComponent(providerCallId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new VoiceProviderError('retell.fetch_call_failed', text);
    }

    return res.json() as Promise<RetellCallResponse>;
  }

  /** Map our generic ToolDefinition schema to Retell's custom function format. */
  mapTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      speak_during_execution: false,
      speak_after_execution: false,
      parameters: tool.parameters,
    }));
  }
}
