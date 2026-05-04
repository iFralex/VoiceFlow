export const bookAppointmentJsonSchema = {
  name: 'book_appointment',
  description:
    'Invoca questo strumento quando il contatto ha accettato di fissare un appuntamento con data e ora precise.',
  parameters: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['date', 'time', 'contact_confirmation_text'],
    properties: {
      date: {
        type: 'string',
        format: 'date',
        description: 'Data dell\'appuntamento in formato ISO 8601 (es. 2024-06-15)',
      },
      time: {
        type: 'string',
        pattern: '^\\d{2}:\\d{2}$',
        description: 'Ora dell\'appuntamento in formato HH:MM (es. 10:30)',
      },
      contact_confirmation_text: {
        type: 'string',
        maxLength: 512,
        description:
          'Testo di conferma pronunciato dal contatto che indica l\'accettazione esplicita (citazione testuale)',
      },
    },
    additionalProperties: false,
  },
} as const;

export interface BookAppointmentArgs {
  date: string;
  time: string;
  contact_confirmation_text: string;
}

/** Handler stub — wired to real persistence in plan 08. */
export async function handleBookAppointment(
  _orgId: string,
  _callId: string,
  _args: BookAppointmentArgs,
): Promise<void> {
  // TODO(plan-08): persist appointment to the database and notify the CRM
}
