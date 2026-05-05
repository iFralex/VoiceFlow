export class VoiceProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(`[${code}] ${detail}`);
    this.name = 'VoiceProviderError';
  }
}
