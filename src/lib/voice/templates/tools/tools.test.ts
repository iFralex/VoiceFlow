import { describe, expect, it } from 'vitest';
import {
  bookAppointmentJsonSchema,
  markNotInterestedJsonSchema,
  markWrongNumberJsonSchema,
  requestCallbackJsonSchema,
  transferToHumanAgentJsonSchema,
  registerOptOutJsonSchema,
  confirmAppointmentJsonSchema,
  rescheduleAppointmentJsonSchema,
  submitSurveyResponseJsonSchema,
  TEMPLATE_TOOLS,
} from './index';

// ---------------------------------------------------------------------------
// Schema shape tests
// ---------------------------------------------------------------------------

describe('bookAppointmentJsonSchema', () => {
  it('has the correct name', () => {
    expect(bookAppointmentJsonSchema.name).toBe('book_appointment');
  });

  it('requires date, time, and contact_confirmation_text', () => {
    expect(bookAppointmentJsonSchema.parameters.required).toContain('date');
    expect(bookAppointmentJsonSchema.parameters.required).toContain('time');
    expect(bookAppointmentJsonSchema.parameters.required).toContain('contact_confirmation_text');
  });

  it('date uses ISO 8601 format', () => {
    expect(bookAppointmentJsonSchema.parameters.properties.date.format).toBe('date');
  });

  it('time pattern enforces HH:MM', () => {
    expect(bookAppointmentJsonSchema.parameters.properties.time.pattern).toBe('^\\d{2}:\\d{2}$');
  });
});

describe('markNotInterestedJsonSchema', () => {
  it('has the correct name', () => {
    expect(markNotInterestedJsonSchema.name).toBe('mark_not_interested');
  });

  it('has no required fields (reason is optional)', () => {
    expect(markNotInterestedJsonSchema.parameters.required).toHaveLength(0);
  });

  it('has an optional reason property', () => {
    expect(markNotInterestedJsonSchema.parameters.properties).toHaveProperty('reason');
  });
});

describe('markWrongNumberJsonSchema', () => {
  it('has the correct name', () => {
    expect(markWrongNumberJsonSchema.name).toBe('mark_wrong_number');
  });

  it('has no required fields', () => {
    expect(markWrongNumberJsonSchema.parameters.required).toHaveLength(0);
  });

  it('has no extra properties (empty args)', () => {
    expect(Object.keys(markWrongNumberJsonSchema.parameters.properties)).toHaveLength(0);
  });
});

describe('requestCallbackJsonSchema', () => {
  it('has the correct name', () => {
    expect(requestCallbackJsonSchema.name).toBe('request_callback');
  });

  it('requires preferred_window', () => {
    expect(requestCallbackJsonSchema.parameters.required).toContain('preferred_window');
  });
});

describe('transferToHumanAgentJsonSchema', () => {
  it('has the correct name', () => {
    expect(transferToHumanAgentJsonSchema.name).toBe('transfer_to_human_agent');
  });

  it('requires reason', () => {
    expect(transferToHumanAgentJsonSchema.parameters.required).toContain('reason');
  });
});

describe('registerOptOutJsonSchema', () => {
  it('has the correct name', () => {
    expect(registerOptOutJsonSchema.name).toBe('register_opt_out');
  });

  it('requires confirmation_text', () => {
    expect(registerOptOutJsonSchema.parameters.required).toContain('confirmation_text');
  });

  it('has a description mentioning absolute priority', () => {
    expect(registerOptOutJsonSchema.description.toLowerCase()).toContain('priorità');
  });
});

describe('confirmAppointmentJsonSchema', () => {
  it('has the correct name', () => {
    expect(confirmAppointmentJsonSchema.name).toBe('confirm_appointment');
  });

  it('requires confirmation_text', () => {
    expect(confirmAppointmentJsonSchema.parameters.required).toContain('confirmation_text');
  });
});

describe('rescheduleAppointmentJsonSchema', () => {
  it('has the correct name', () => {
    expect(rescheduleAppointmentJsonSchema.name).toBe('reschedule_appointment');
  });

  it('requires new_date, new_time, and contact_confirmation_text', () => {
    expect(rescheduleAppointmentJsonSchema.parameters.required).toContain('new_date');
    expect(rescheduleAppointmentJsonSchema.parameters.required).toContain('new_time');
    expect(rescheduleAppointmentJsonSchema.parameters.required).toContain(
      'contact_confirmation_text',
    );
  });

  it('new_time pattern enforces HH:MM', () => {
    expect(rescheduleAppointmentJsonSchema.parameters.properties.new_time.pattern).toBe(
      '^\\d{2}:\\d{2}$',
    );
  });
});

describe('submitSurveyResponseJsonSchema', () => {
  it('has the correct name', () => {
    expect(submitSurveyResponseJsonSchema.name).toBe('submit_survey_response');
  });

  it('requires overall_satisfaction', () => {
    expect(submitSurveyResponseJsonSchema.parameters.required).toContain('overall_satisfaction');
  });

  it('overall_satisfaction is an integer between 1 and 10', () => {
    const prop = submitSurveyResponseJsonSchema.parameters.properties.overall_satisfaction;
    expect(prop.type).toBe('integer');
    expect(prop.minimum).toBe(1);
    expect(prop.maximum).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Per-template tool selection
// ---------------------------------------------------------------------------

describe('TEMPLATE_TOOLS', () => {
  const allTemplateSlugs = [
    'lead-reactivation',
    'appointment-confirm',
    'car-renewal',
    'post-sale-followup',
    'csi-survey',
  ] as const;

  it('has entries for all five templates', () => {
    for (const slug of allTemplateSlugs) {
      expect(TEMPLATE_TOOLS).toHaveProperty(slug);
    }
  });

  it('lead-reactivation includes all six base tools', () => {
    const names = TEMPLATE_TOOLS['lead-reactivation'].map((t) => t.name);
    expect(names).toContain('book_appointment');
    expect(names).toContain('mark_not_interested');
    expect(names).toContain('mark_wrong_number');
    expect(names).toContain('request_callback');
    expect(names).toContain('transfer_to_human_agent');
    expect(names).toContain('register_opt_out');
  });

  it('appointment-confirm does NOT include book_appointment (appointment already exists)', () => {
    const names = TEMPLATE_TOOLS['appointment-confirm'].map((t) => t.name);
    expect(names).not.toContain('book_appointment');
  });

  it('appointment-confirm includes confirm_appointment and reschedule_appointment', () => {
    const names = TEMPLATE_TOOLS['appointment-confirm'].map((t) => t.name);
    expect(names).toContain('confirm_appointment');
    expect(names).toContain('reschedule_appointment');
  });

  it('csi-survey includes submit_survey_response', () => {
    const names = TEMPLATE_TOOLS['csi-survey'].map((t) => t.name);
    expect(names).toContain('submit_survey_response');
  });

  it('csi-survey includes transfer_to_human_agent and register_opt_out', () => {
    const names = TEMPLATE_TOOLS['csi-survey'].map((t) => t.name);
    expect(names).toContain('transfer_to_human_agent');
    expect(names).toContain('register_opt_out');
  });

  it('csi-survey does NOT include book_appointment (survey, not sales)', () => {
    const names = TEMPLATE_TOOLS['csi-survey'].map((t) => t.name);
    expect(names).not.toContain('book_appointment');
  });

  it('every template includes register_opt_out', () => {
    for (const slug of allTemplateSlugs) {
      const names = TEMPLATE_TOOLS[slug].map((t) => t.name);
      expect(names).toContain('register_opt_out');
    }
  });

  it('every tool has a non-empty name and description', () => {
    for (const slug of allTemplateSlugs) {
      for (const tool of TEMPLATE_TOOLS[slug]) {
        expect(tool.name.length).toBeGreaterThan(0);
        expect(tool.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('no duplicate tool names within a single template', () => {
    for (const slug of allTemplateSlugs) {
      const names = TEMPLATE_TOOLS[slug].map((t) => t.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    }
  });
});
