import { env } from '@/lib/env';
import type { VoiceProvider, CreateCallParams, TranscriptSegment, ToolDefinition } from '../types';
import { VoiceProviderError } from '../errors';

// Re-export so existing imports from this module continue to work
export { VoiceProviderError } from '../errors';

// Vapi REST API response shapes (minimal — only fields we consume)
interface VapiCallResponse {
  id: string;
  status?: string;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  artifact?: {
    recordingUrl?: string;
    stereoRecordingUrl?: string;
    messages?: VapiMessage[];
  };
  messages?: VapiMessage[];
}

interface VapiMessage {
  role: 'assistant' | 'user' | 'tool' | 'system' | string;
  message?: string;
  content?: string;
  time?: number; // seconds from epoch or call start (Vapi uses call-relative seconds)
  endTime?: number;
  secondsFromStart?: number;
  duration?: number;
}

const VAPI_BASE_URL = 'https://api.vapi.ai';

export class VapiAdapter implements VoiceProvider {
  name = 'vapi' as const;

  constructor(private readonly apiKey: string) {}

  async createCall(params: CreateCallParams): Promise<{ providerCallId: string }> {
    const body = {
      phoneNumberId: params.fromNumber,
      customer: { number: params.toNumber },
      assistantId: env.VAPI_ASSISTANT_ID,
      assistantOverrides: {
        firstMessage: params.firstMessage,
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: params.systemPrompt,
          tools: this.mapTools(params.endCallFunctions),
        },
        voice: {
          provider: '11labs',
          voiceId: params.voiceId,
          model: 'eleven_multilingual_v2',
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'it',
        },
        endCallFunctionEnabled: true,
        recordingEnabled: params.recordingEnabled,
        backgroundDenoisingEnabled: true,
        maxDurationSeconds: params.maxDurationSeconds,
        hipaaEnabled: false,
      },
      metadata: params.metadata,
      serverUrl: params.webhookUrl,
      serverUrlSecret: env.VAPI_WEBHOOK_SECRET,
    };

    const res = await fetch(`${VAPI_BASE_URL}/call`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new VoiceProviderError('vapi.create_call_failed', text);
    }

    const json = (await res.json()) as VapiCallResponse;
    return { providerCallId: json.id };
  }

  async cancelCall(providerCallId: string): Promise<void> {
    const res = await fetch(`${VAPI_BASE_URL}/call/${encodeURIComponent(providerCallId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new VoiceProviderError('vapi.cancel_call_failed', text);
    }
  }

  async fetchRecording(providerCallId: string): Promise<{ url: string; bytes: Buffer | null }> {
    const call = await this.fetchCall(providerCallId);

    const url =
      call.artifact?.recordingUrl ??
      call.artifact?.stereoRecordingUrl ??
      call.recordingUrl ??
      call.stereoRecordingUrl;

    if (!url) {
      throw new VoiceProviderError(
        'vapi.recording_not_available',
        `No recording URL for call ${providerCallId}`,
      );
    }

    // Attempt to download the bytes; return null if the download fails (e.g. still processing)
    let bytes: Buffer | null = null;
    try {
      const dlRes = await fetch(url);
      if (dlRes.ok) {
        const arrayBuffer = await dlRes.arrayBuffer();
        bytes = Buffer.from(arrayBuffer);
      }
    } catch {
      // bytes stays null — caller can retry
    }

    return { url, bytes };
  }

  async fetchTranscript(providerCallId: string): Promise<TranscriptSegment[]> {
    const call = await this.fetchCall(providerCallId);

    // Prefer the structured messages from the artifact if available
    const messages = call.artifact?.messages ?? call.messages ?? [];

    return messages
      .filter((m) => m.role === 'assistant' || m.role === 'user')
      .map((m): TranscriptSegment => {
        const text = m.message ?? m.content ?? '';
        const startMs = Math.round((m.secondsFromStart ?? m.time ?? 0) * 1000);
        const durationMs = Math.round((m.duration ?? 0) * 1000);
        const endMs = m.endTime != null ? Math.round(m.endTime * 1000) : startMs + durationMs;

        return {
          speaker: m.role === 'assistant' ? 'agent' : 'caller',
          text,
          startMs,
          endMs,
        };
      });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async fetchCall(providerCallId: string): Promise<VapiCallResponse> {
    const res = await fetch(`${VAPI_BASE_URL}/call/${encodeURIComponent(providerCallId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new VoiceProviderError('vapi.fetch_call_failed', text);
    }

    return res.json() as Promise<VapiCallResponse>;
  }

  /** Map our generic ToolDefinition schema to Vapi's function-tool format. */
  private mapTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}
