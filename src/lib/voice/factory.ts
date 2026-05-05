import { env } from '@/lib/env';
import type { VoiceProvider } from './types';
import { VapiAdapter } from './vapi/adapter';
import { RetellAdapter } from './retell/adapter';

export function getVoiceProvider(): VoiceProvider {
  switch (env.VOICE_PROVIDER) {
    case 'vapi':
      return new VapiAdapter(env.VAPI_API_KEY!);
    case 'retell':
      return new RetellAdapter(env.RETELL_API_KEY!);
    default:
      throw new Error('Unknown voice provider');
  }
}

/**
 * Returns a provider instance for a specific provider name.
 * Used by persistence helpers that store the provider used for a call
 * and need to fetch artifacts from the same provider later.
 */
export function getVoiceProviderByName(provider: string): VoiceProvider {
  switch (provider) {
    case 'vapi':
      if (!env.VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
      return new VapiAdapter(env.VAPI_API_KEY);
    case 'retell':
      if (!env.RETELL_API_KEY) throw new Error('RETELL_API_KEY not configured');
      return new RetellAdapter(env.RETELL_API_KEY);
    default:
      throw new Error(`Unknown voice provider: ${provider}`);
  }
}
