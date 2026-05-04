export const rescheduleAppointmentJsonSchema = {
  name: 'reschedule_appointment',
  description:
    'Invoca questo strumento quando il contatto desidera spostare l\'appuntamento esistente a una data/ora diversa.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['new_date', 'new_time', 'contact_confirmation_text'],
    properties: {
      new_date: {
        type: 'string',
        format: 'date',
        description: 'Nuova data dell\'appuntamento in formato ISO 8601 (es. 2024-06-20)',
      },
      new_time: {
        type: 'string',
        pattern: '^\\d{2}:\\d{2}$',
        description: 'Nuova ora dell\'appuntamento in formato HH:MM (es. 14:00)',
      },
      contact_confirmation_text: {
        type: 'string',
        maxLength: 512,
        description:
          'Testo esatto pronunciato dal contatto che conferma il nuovo orario (citazione testuale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface RescheduleAppointmentArgs {
  new_date: string;
  new_time: string;
  contact_confirmation_text: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleRescheduleAppointment(
  _orgId: string,
  _callId: string,
  _args: RescheduleAppointmentArgs,
): Promise<void> {
  // TODO(plan-08): update appointment in database and notify calendar
}
