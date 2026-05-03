import { describe, expect, it } from 'vitest';
import { scriptTemplateSeedData } from './script_templates';

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

  it('every template has version 1', () => {
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

  it('every template system_prompt contains the AI Act disclosure', () => {
    for (const t of scriptTemplateSeedData) {
      expect(t.system_prompt).toContain('AI ACT DISCLOSURE');
      expect(t.system_prompt).toContain('assistente AI');
    }
  });

  it('every template has a non-empty system_prompt', () => {
    for (const t of scriptTemplateSeedData) {
      expect(typeof t.system_prompt).toBe('string');
      expect(t.system_prompt.length).toBeGreaterThan(100);
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

  it('lead-reactivation has required variables: dealership_name, brand, salesperson_first_name, available_slots, lead_origin_context, incentive_to_offer', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'lead-reactivation')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('dealership_name');
    expect(schema.required).toContain('brand');
    expect(schema.required).toContain('salesperson_first_name');
    expect(schema.required).toContain('available_slots');
    expect(schema.required).toContain('lead_origin_context');
    expect(schema.required).toContain('incentive_to_offer');
  });

  it('appointment-confirm has required variables including appointment_date, appointment_time, appointment_type', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'appointment-confirm')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('appointment_date');
    expect(schema.required).toContain('appointment_time');
    expect(schema.required).toContain('appointment_type');
    expect(schema.required).toContain('dealership_address');
  });

  it('car-renewal has required variables including current_car_model and trade_in_offer', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'car-renewal')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('current_car_model');
    expect(schema.required).toContain('trade_in_offer');
    expect(schema.required).toContain('suggested_models');
  });

  it('post-sale-followup has required variables including purchased_vehicle and purchase_date', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'post-sale-followup')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('purchased_vehicle');
    expect(schema.required).toContain('purchase_date');
    expect(schema.required).toContain('salesperson_name');
  });

  it('csi-survey has required variables including vehicle_model, delivery_date, case_number', () => {
    const t = scriptTemplateSeedData.find((x) => x.slug === 'csi-survey')!;
    const schema = t.variable_schema as { required: string[] };
    expect(schema.required).toContain('vehicle_model');
    expect(schema.required).toContain('delivery_date');
    expect(schema.required).toContain('case_number');
    expect(schema.required).toContain('brand');
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
