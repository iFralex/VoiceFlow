import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { interpolate } from '@/lib/voice/prompt/preamble';

const PROMPTS_DIR = path.join(__dirname);

const TEMPLATE_CASES = [
  {
    slug: 'lead-reactivation',
    file: 'lead-reactivation-first-message.txt',
    sampleVars: {
      salesperson_first_name: 'Luca',
      dealership_name: 'AutoRoma',
      brand: 'Volkswagen',
    },
  },
  {
    slug: 'appointment-confirm',
    file: 'appointment-confirm-first-message.txt',
    sampleVars: {
      salesperson_first_name: 'Luca',
      dealership_name: 'AutoRoma',
      appointment_date: 'lunedì 12 maggio 2026',
      appointment_time: '10:30',
    },
  },
  {
    slug: 'car-renewal',
    file: 'car-renewal-first-message.txt',
    sampleVars: {
      salesperson_first_name: 'Luca',
      dealership_name: 'AutoRoma',
      current_vehicle_model: 'Volkswagen Golf 1.6 TDI',
    },
  },
  {
    slug: 'post-sale-followup',
    file: 'post-sale-followup-first-message.txt',
    sampleVars: {
      salesperson_first_name: 'Luca',
      dealership_name: 'AutoRoma',
      vehicle_model: 'Audi A3 Sportback',
      delivery_date: '15 aprile 2026',
    },
  },
  {
    slug: 'csi-survey',
    file: 'csi-survey-first-message.txt',
    sampleVars: {
      dealership_name: 'AutoRoma',
      manufacturer_brand: 'BMW',
      vehicle_model: 'BMW Serie 3 320d',
    },
  },
] as const;

describe('first-message templates', () => {
  for (const { slug, file, sampleVars } of TEMPLATE_CASES) {
    describe(slug, () => {
      const filePath = path.join(PROMPTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8').trim();

      it('file exists and is non-empty', () => {
        expect(content.length).toBeGreaterThan(0);
      });

      it('contains mandatory AI disclosure phrase', () => {
        expect(content.toLowerCase()).toContain('assistente vocale automatico');
      });

      it('contains "intelligenza artificiale" disclosure', () => {
        expect(content.toLowerCase()).toContain('intelligenza artificiale');
      });

      it('interpolates successfully with sample variables', () => {
        // Passing extra keys is fine; interpolate ignores them
        const allVars: Record<string, string> = { ...sampleVars };
        expect(() => interpolate(content, allVars)).not.toThrow();
      });

      it('interpolated result does not contain unresolved placeholders', () => {
        const allVars: Record<string, string> = { ...sampleVars };
        const result = interpolate(content, allVars);
        expect(result).not.toMatch(/\{\{\w+\}\}/);
      });

      it('is a single utterance (no markdown, no section headers)', () => {
        expect(content).not.toMatch(/^#/m);
        expect(content).not.toMatch(/^---/m);
      });
    });
  }
});
