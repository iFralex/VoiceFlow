import { NewVoiceCatalogueEntry } from '../schema/voice_catalogue';

/**
 * Placeholder ElevenLabs Italian voices.
 * Real external_voice_id values will be filled in during plan 08.
 * These rows ensure the table is seeded and templates' default_voice_id
 * can reference a known catalogue entry.
 */
export const voiceCatalogueSeedData: NewVoiceCatalogueEntry[] = [
  {
    provider: 'proprietary',
    external_voice_id: 'elevenlabs-placeholder-it-female-01',
    display_name: 'Giulia (Italian, Female)',
    language: 'it-IT',
    gender: 'female',
    style: 'conversational',
    sample_url: null,
    active: true,
    default_for_templates: [
      'lead-reactivation',
      'appointment-confirm',
      'post-sale-followup',
    ],
  },
  {
    provider: 'proprietary',
    external_voice_id: 'elevenlabs-placeholder-it-male-01',
    display_name: 'Marco (Italian, Male)',
    language: 'it-IT',
    gender: 'male',
    style: 'conversational',
    sample_url: null,
    active: true,
    default_for_templates: ['car-renewal', 'csi-survey'],
  },
];
