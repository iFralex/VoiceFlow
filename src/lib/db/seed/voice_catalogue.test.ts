import { describe, expect, it } from 'vitest';

import {
  CHIARA_VOICE_ID,
  GIULIA_VOICE_ID,
  LUCA_VOICE_ID,
  MARCO_VOICE_ID,
  SOFIA_VOICE_ID,
  voiceCatalogueSeedData,
} from './voice_catalogue';

describe('voiceCatalogueSeedData', () => {
  it('contains exactly five entries', () => {
    expect(voiceCatalogueSeedData).toHaveLength(5);
  });

  it('all entries use provider vapi', () => {
    for (const entry of voiceCatalogueSeedData) {
      expect(entry.provider).toBe('vapi');
    }
  });

  it('all entries have language it-IT', () => {
    for (const entry of voiceCatalogueSeedData) {
      expect(entry.language).toBe('it-IT');
    }
  });

  it('all entries are active', () => {
    for (const entry of voiceCatalogueSeedData) {
      expect(entry.active).toBe(true);
    }
  });

  it('all entries have a non-empty display_name', () => {
    for (const entry of voiceCatalogueSeedData) {
      expect(typeof entry.display_name).toBe('string');
      expect(entry.display_name.length).toBeGreaterThan(0);
    }
  });

  it('all entries have a 20-character external_voice_id', () => {
    for (const entry of voiceCatalogueSeedData) {
      expect(entry.external_voice_id).toMatch(/^[A-Za-z0-9]{20}$/);
    }
  });

  it('has two female voices', () => {
    const females = voiceCatalogueSeedData.filter((e) => e.gender === 'female');
    expect(females).toHaveLength(2);
  });

  it('has two male voices', () => {
    const males = voiceCatalogueSeedData.filter((e) => e.gender === 'male');
    expect(males).toHaveLength(2);
  });

  it('has one neutral voice', () => {
    const neutral = voiceCatalogueSeedData.filter((e) => e.gender === 'neutral');
    expect(neutral).toHaveLength(1);
  });

  it('has two sales-style voices for female and male each', () => {
    const salesVoices = voiceCatalogueSeedData.filter((e) => e.style === 'sales');
    expect(salesVoices).toHaveLength(4);
  });

  it('has one survey-style voice', () => {
    const surveyVoices = voiceCatalogueSeedData.filter((e) => e.style === 'survey');
    expect(surveyVoices).toHaveLength(1);
    expect(surveyVoices[0]!.gender).toBe('neutral');
  });

  it('all external_voice_ids are unique', () => {
    const ids = voiceCatalogueSeedData.map((e) => e.external_voice_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exported voice ID constants match seed data entries', () => {
    const ids = voiceCatalogueSeedData.map((e) => e.external_voice_id);
    expect(ids).toContain(GIULIA_VOICE_ID);
    expect(ids).toContain(SOFIA_VOICE_ID);
    expect(ids).toContain(MARCO_VOICE_ID);
    expect(ids).toContain(LUCA_VOICE_ID);
    expect(ids).toContain(CHIARA_VOICE_ID);
  });

  it('every template slug has exactly one default voice entry', () => {
    const allTemplates = voiceCatalogueSeedData.flatMap((e) => e.default_for_templates ?? []);
    const expected = [
      'lead-reactivation',
      'appointment-confirm',
      'car-renewal',
      'post-sale-followup',
      'csi-survey',
    ];
    for (const slug of expected) {
      const count = allTemplates.filter((s) => s === slug).length;
      expect(count).toBe(1);
    }
  });

  it('Giulia is default for lead-reactivation and appointment-confirm', () => {
    const giulia = voiceCatalogueSeedData.find((e) => e.external_voice_id === GIULIA_VOICE_ID)!;
    expect(giulia.default_for_templates).toContain('lead-reactivation');
    expect(giulia.default_for_templates).toContain('appointment-confirm');
  });

  it('Marco is default for car-renewal', () => {
    const marco = voiceCatalogueSeedData.find((e) => e.external_voice_id === MARCO_VOICE_ID)!;
    expect(marco.default_for_templates).toContain('car-renewal');
  });

  it('Chiara is default for csi-survey', () => {
    const chiara = voiceCatalogueSeedData.find((e) => e.external_voice_id === CHIARA_VOICE_ID)!;
    expect(chiara.default_for_templates).toContain('csi-survey');
  });
});
