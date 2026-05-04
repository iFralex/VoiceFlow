/**
 * ElevenLabs TTS adapter.
 *
 * Thin wrapper around the ElevenLabs text-to-speech API.
 * Used by the voice-sample preview feature (plan 07) and the call dispatch
 * pipeline (plan 08).
 */

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

/**
 * Fallback ElevenLabs voice ID used when a script's configured voice is still
 * a placeholder (populated in plan 08).  Rachel — multilingual model.
 */
export const ELEVENLABS_DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/**
 * Synthesizes `text` with ElevenLabs TTS and returns the raw MP3 buffer.
 *
 * @param text    The text to speak (keep short to minimise credit usage).
 * @param voiceId ElevenLabs external voice ID.
 * @param apiKey  ElevenLabs API key.
 */
export async function synthesizeSpeech(args: {
  text: string;
  voiceId: string;
  apiKey: string;
}): Promise<Buffer> {
  const response = await fetch(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${args.voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': args.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: args.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`ElevenLabs TTS error ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
