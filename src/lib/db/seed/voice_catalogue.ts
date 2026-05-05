import { NewVoiceCatalogueEntry } from '../schema/voice_catalogue';

/**
 * ElevenLabs Italian voices routed through Vapi.
 *
 * Both Vapi and Retell forward ElevenLabs voice IDs unchanged, so all entries
 * carry provider='vapi'.  The external_voice_id values are the ElevenLabs
 * voice IDs as displayed in the ElevenLabs dashboard (20-char alphanumeric).
 *
 * To update: sign in to app.elevenlabs.io → Voices, copy the ID from the
 * URL or voice card, and paste it here.  Re-run `pnpm db:seed` to upsert.
 */

// ---------------------------------------------------------------------------
// Canonical ElevenLabs Italian voice IDs
// ---------------------------------------------------------------------------

/** Female – warm, natural Italian voice; primary for outbound sales scripts. */
export const GIULIA_VOICE_ID = 'bVMeCyTHy58xNoL34h3p';

/** Female – clear, professional Italian voice; secondary sales / follow-up. */
export const SOFIA_VOICE_ID = 'kdmDxFv7KrJPwGrFyDGi';

/** Male – deep, confident Italian voice; vehicle-renewal and car sales. */
export const MARCO_VOICE_ID = '29vD33N1CtxCmqQRPOHJ';

/** Male – friendly, energetic Italian voice; appointment reminder tone. */
export const LUCA_VOICE_ID = 'AZnzlk1XvdvUeBnXmlld';

/** Neutral – measured, clear Italian voice; surveys and CSI scripts. */
export const CHIARA_VOICE_ID = 'pNInz6obpgDQGcFmaJgB';

// ---------------------------------------------------------------------------
// Seed rows
// ---------------------------------------------------------------------------

export const voiceCatalogueSeedData: NewVoiceCatalogueEntry[] = [
  {
    provider: 'vapi',
    external_voice_id: GIULIA_VOICE_ID,
    display_name: 'Giulia (Italian, Female)',
    language: 'it-IT',
    gender: 'female',
    style: 'sales',
    sample_url: null,
    active: true,
    default_for_templates: ['lead-reactivation', 'appointment-confirm'],
  },
  {
    provider: 'vapi',
    external_voice_id: SOFIA_VOICE_ID,
    display_name: 'Sofia (Italian, Female)',
    language: 'it-IT',
    gender: 'female',
    style: 'sales',
    sample_url: null,
    active: true,
    default_for_templates: ['post-sale-followup'],
  },
  {
    provider: 'vapi',
    external_voice_id: MARCO_VOICE_ID,
    display_name: 'Marco (Italian, Male)',
    language: 'it-IT',
    gender: 'male',
    style: 'sales',
    sample_url: null,
    active: true,
    default_for_templates: ['car-renewal'],
  },
  {
    provider: 'vapi',
    external_voice_id: LUCA_VOICE_ID,
    display_name: 'Luca (Italian, Male)',
    language: 'it-IT',
    gender: 'male',
    style: 'sales',
    sample_url: null,
    active: true,
    default_for_templates: [],
  },
  {
    provider: 'vapi',
    external_voice_id: CHIARA_VOICE_ID,
    display_name: 'Chiara (Italian, Neutral)',
    language: 'it-IT',
    gender: 'neutral',
    style: 'survey',
    sample_url: null,
    active: true,
    default_for_templates: ['csi-survey'],
  },
];
