import { describe, expect, it } from 'vitest';

import {
  buildScriptTemplateSeedData,
  scriptTemplateSeedData,
  TEMPLATE_DEFINITIONS,
} from './script_templates';

const EXPECTED_SLUGS = [
  'lead-reactivation',
  'appointment-confirm',
  'car-renewal',
  'post-sale-followup',
  'csi-survey',
];

describe('script_templates seed data', () => {
  it('contains exactly five templates', () => {
    expect(scriptTemplateSeedData).toHaveLength(5);
  });

  it('has all expected slugs', () => {
    const slugs = scriptTemplateSeedData.map((t) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(EXPECTED_SLUGS));
    expect(slugs).toHaveLength(EXPECTED_SLUGS.length);
  });

  it('every template has version 1 (base version)', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.version).toBe(1);
    }
  });

  it('every template has published_at set', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.published_at).toBeInstanceOf(Date);
    }
  });

  it('every template has default_language it-IT', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.default_language).toBe('it-IT');
    }
  });

  it('every template has a default_voice_id', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.default_voice_id).toBeTruthy();
    }
  });

  it('every template system_prompt is read from disk and non-empty', () => {
    for (const t of scriptTemplateSeedData) {
      expect(typeof t.system_prompt).toBe('string');
      expect(t.system_prompt.length).toBeGreaterThan(100);
    }
  });

  it('every template system_prompt contains the AI disclosure phrase', () => {
    for (const t of scriptTemplateSeedData) {
      // The .txt files use "assistente vocale automatico" (canonical phrase)
      expect(t.system_prompt.toLowerCase()).toContain('assistente vocale automatico');
    }
  });

  it('every template system_prompt mentions intelligenza artificiale', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.system_prompt.toLowerCase()).toContain('intelligenza artificiale');
    }
  });

  it('every template has a variable_schema with type object', () => {
    for (const t of scriptTemplateSeedData) {
      const schema = t.variable_schema as { type: string; required: string[] };
      expect(schema.type).toBe('object');
      expect(Array.isArray(schema.required)).toBe(true);
      expect((schema.required as string[]).length).toBeGreaterThan(0);
    }
  });

  it('lead-reactivation variable_schema has canonical required fields', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'lead-reactivation')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('brand');
    expect(schema.required).toContain('salesperson_first_name');
    expect(schema.required).toContain('available_slots');
    expect(schema.required).toContain('lead_origin_context');
    // incentive_to_offer is optional in the canonical schema
  });

  it('appointment-confirm variable_schema has canonical required fields', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'appointment-confirm')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('appointment_date');
    expect(schema.required).toContain('appointment_time');
    expect(schema.required).toContain('service_type');
    expect(schema.required).toContain('salesperson_first_name');
  });

  it('car-renewal variable_schema has canonical required fields', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'car-renewal')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('salesperson_first_name');
    expect(schema.required).toContain('current_vehicle_model');
    expect(schema.required).toContain('years_since_purchase');
    expect(schema.required).toContain('available_slots');
    // trade_in_offer_summary is optional
  });

  it('post-sale-followup variable_schema has canonical required fields', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'post-sale-followup')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('vehicle_model');
    expect(schema.required).toContain('delivery_date');
    expect(schema.required).toContain('salesperson_first_name');
    expect(schema.required).toContain('service_reminder_window');
  });

  it('csi-survey variable_schema has canonical required fields', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'csi-survey')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('manufacturer_brand');
    expect(schema.required).toContain('vehicle_model');
    expect(schema.required).toContain('service_type');
    expect(schema.required).toContain('last_interaction_date');
  });

  it('every variable_schema has additionalProperties: false', () => {
    for (const t of scriptTemplateSeedData) {
      const schema = t.variable_schema as { additionalProperties: boolean };
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('every template has a non-empty name', () => {
    for (const t of scriptTemplateSeedData) {
      expect(typeof t.name).toBe('string');
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});

describe('TEMPLATE_DEFINITIONS', () => {
  it('has an entry for each expected slug', () => {
    const slugs = TEMPLATE_DEFINITIONS.map((d) => d.slug);
    expect(slugs).toEqual(expect.arrayContaining(EXPECTED_SLUGS));
    expect(slugs).toHaveLength(EXPECTED_SLUGS.length);
  });

  it('every definition has promptFile and firstMessageFile set', () => {
    for (const def of TEMPLATE_DEFINITIONS) {
      expect(def.promptFile).toBeTruthy();
      expect(def.firstMessageFile).toBeTruthy();
    }
  });
});

describe('buildScriptTemplateSeedData', () => {
  it('returns five rows with default versions when called with no overrides', () => {
    const rows = buildScriptTemplateSeedData();
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.version).toBe(1);
    }
  });

  it('applies versionOverride for the specified slug only', () => {
    const rows = buildScriptTemplateSeedData({ 'lead-reactivation': 3 });
    const lr = rows.find((r) => r.slug === 'lead-reactivation')!;
    expect(lr.version).toBe(3);
    // Other slugs remain at base version 1
    for (const row of rows.filter((r) => r.slug !== 'lead-reactivation')) {
      expect(row.version).toBe(1);
    }
  });

  it('reads the same system_prompt from disk as scriptTemplateSeedData', () => {
    const fresh = buildScriptTemplateSeedData();
    for (let i = 0; i < fresh.length; i++) {
      expect(fresh[i]!.system_prompt).toBe(scriptTemplateSeedData[i]!.system_prompt);
    }
  });
});
