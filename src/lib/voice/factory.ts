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
