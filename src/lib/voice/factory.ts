import { env } from '@/lib/env';

import { RetellAdapter } from './retell/adapter';
import type { VoiceProvider } from './types';
import { VapiAdapter } from './vapi/adapter';

export function getVoiceProvider(): VoiceProvider {
  switch (env.VOICE_PROVIDER) {
    case 'vapi':
      if (!env.VAPI_API_KEY) throw new Error('VAPI_API_KEY not configured');
      if (!env.VAPI_ASSISTANT_ID) throw new Error('VAPI_ASSISTANT_ID not configured');
      return new VapiAdapter(env.VAPI_API_KEY);
    case 'retell':
      if (!env.RETELL_API_KEY) throw new Error('RETELL_API_KEY not configured');
      return new RetellAdapter(env.RETELL_API_KEY);
    case 'proprietary':
      // Phase 2 placeholder — proprietary stack not yet implemented.
      // Set VOICE_PROVIDER=vapi or VOICE_PROVIDER=retell for Phase 1.
      throw new Error(
        'VOICE_PROVIDER=proprietary is reserved for Phase 2. ' +
          'Use "vapi" or "retell" until the proprietary stack is deployed. ' +
          'See docs/architecture-decisions/0004-phase-2-voice.md for the migration plan.',
      );
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
    case 'proprietary':
      throw new Error(
        'Voice provider "proprietary" is a Phase 2 placeholder and is not yet implemented. ' +
          'See docs/architecture-decisions/0004-phase-2-voice.md.',
      );
    default:
      throw new Error(`Unknown voice provider: ${provider}`);
  }
}
