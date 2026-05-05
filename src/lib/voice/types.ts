export interface VoiceProvider {
  name: 'vapi' | 'retell' | 'proprietary';
  createCall(params: CreateCallParams): Promise<{ providerCallId: string }>;
  cancelCall(providerCallId: string): Promise<void>;
  fetchRecording(providerCallId: string): Promise<{ url: string; bytes: Buffer | null }>;
  fetchTranscript(providerCallId: string): Promise<TranscriptSegment[]>;
}

export interface CreateCallParams {
  toNumber: string;
  fromNumber: string;
  systemPrompt: string;
  firstMessage: string;
  voiceId: string;
  language: 'it-IT';
  maxDurationSeconds: number;
  webhookUrl: string;
  metadata: { orgId: string; campaignId: string; callId: string; contactId: string };
  endCallFunctions: ToolDefinition[];
  amdEnabled: boolean;
  recordingEnabled: boolean;
  /** E.164 phone number to warm-transfer to when the AI invokes transfer_to_human_agent. */
  transferTargetPhone?: string;
  /** Message the AI should read after the voicemail beep. Requires amdEnabled=true. */
  voicemailMessage?: string;
}

export type TranscriptSegment = {
  speaker: 'agent' | 'caller';
  text: string;
  startMs: number;
  endMs: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
};
